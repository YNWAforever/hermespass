import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe : describe.skip;

if (databaseRequired) {
  describe("PostgreSQL integration test configuration", () => {
    it("requires DATABASE_URL_TEST", () => {
      expect(databaseUrl, "DATABASE_URL_TEST is required for bun run test:db").toBeTruthy();
    });
  });
}

type SqlClient = Pool | PoolClient;

type Fixtures = {
  adminId: string;
  organizationId: string;
  otherOrganizationId: string;
  ownerId: string;
  viewerId: string;
};

const migrationPath = join(process.cwd(), "drizzle", "0000_low_human_robot.sql");

function suffix(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

async function applyMigration(pool: Pool): Promise<void> {
  const migration = await readFile(migrationPath, "utf8");
  const client = await pool.connect();

  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_app') THEN
          CREATE ROLE hermes_app LOGIN BYPASSRLS CREATEDB CREATEROLE;
        END IF;
      END
    $$`);
    await client.query("ALTER ROLE hermes_app BYPASSRLS CREATEDB CREATEROLE");
    await client.query("GRANT CREATE ON SCHEMA public TO PUBLIC");
    await client.query("GRANT CREATE ON SCHEMA public TO hermes_app");

    for (const statement of migration.split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (sql) await client.query(sql);
    }
  } finally {
    client.release();
  }
}

async function withAppUser<T>(
  pool: Pool,
  userId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await client.query("SELECT set_config('hermes.user_id', $1, true)", [userId]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

async function insertAgent(
  client: SqlClient,
  organizationId: string,
  label: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO agents (
      organization_id, slug, did, name, role, risk, scopes, spend_cap_cents,
      credential_id, credential_jws, issued_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, 'Integration agent', 'operator', 'low', ARRAY['catalog.read']::text[], 0,
      $4, 'signed-credential', now(), now() + interval '1 day', 'integration-test'
    ) RETURNING id`,
    [organizationId, `agent-${label}`, `did:web:integration:${label}`, `credential-${label}`],
  );

  return result.rows[0]!.id;
}

async function insertAudit(
  client: SqlClient,
  organizationId: string,
  label: string,
): Promise<void> {
  await client.query(
    `INSERT INTO agent_audit_logs (organization_id, actor_type, actor_id, action, summary)
     VALUES ($1, 'user', 'integration-admin', $2, 'integration audit entry')`,
    [organizationId, `audit.${label}`],
  );
}

async function expectSqlState(operation: () => Promise<unknown>, code: string): Promise<void> {
  await expect(operation()).rejects.toMatchObject({ code });
}

dbTest("PostgreSQL identity and audit controls", () => {
  let pool: Pool;
  let fixtures: Fixtures;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 12 });
    await applyMigration(pool);

    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const viewerId = `viewer-${suffix()}`;
    const adminId = `admin-${suffix()}`;
    const ownerId = `owner-${suffix()}`;

    await pool.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Primary organization', $2), ($3, 'Other organization', $4)",
      [organizationId, `primary-${suffix()}`, otherOrganizationId, `other-${suffix()}`],
    );
    await pool.query(
      "INSERT INTO org_members (organization_id, user_id, role) VALUES ($1, $2, 'viewer'), ($1, $3, 'admin'), ($1, $4, 'owner')",
      [organizationId, viewerId, adminId, ownerId],
    );
    await insertAgent(pool, organizationId, `seed-${suffix()}`);
    await insertAgent(pool, otherOrganizationId, `other-${suffix()}`);

    fixtures = { adminId, organizationId, otherOrganizationId, ownerId, viewerId };
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("applies the checked-in migration with forced RLS, restricted role, functions, and triggers", async () => {
    const [tables, functions, role, publicCreate, schemaPrivilege, ownedObjects, triggers] =
      await Promise.all([
        pool.query(
          "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname",
          [
            [
              "organizations",
              "org_members",
              "issuer_keys",
              "agents",
              "agent_keys",
              "agent_audit_logs",
            ],
          ],
        ),
        pool.query("SELECT proname FROM pg_proc WHERE proname = ANY($1::text[])", [
          [
            "hermes_current_user_id",
            "hermes_audit_hash",
            "hermes_audit_before_insert",
            "hermes_audit_immutable",
            "hermes_verify_audit_chain",
            "hermes_public_issuer_key",
            "hermes_public_issuer_key_for_fragment",
            "hermes_public_agent",
            "hermes_public_agent_by_did",
          ],
        ]),
        pool.query(
          "SELECT rolbypassrls, rolcreatedb, rolcreaterole, rolsuper FROM pg_roles WHERE rolname = 'hermes_app'",
        ),
        pool.query(
          `SELECT count(*)::int AS count
         FROM pg_namespace n
         CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
         WHERE n.nspname = 'public' AND acl.grantee = 0 AND acl.privilege_type = 'CREATE'`,
        ),
        pool.query("SELECT has_schema_privilege('hermes_app', 'public', 'CREATE') AS can_create"),
        pool.query(
          `SELECT count(*)::int AS count
         FROM pg_class
         WHERE relnamespace = 'public'::regnamespace
           AND relowner = (SELECT oid FROM pg_roles WHERE rolname = 'hermes_app')`,
        ),
        pool.query("SELECT tgname FROM pg_trigger WHERE tgname = ANY($1::text[])", [
          ["agent_audit_before_insert", "agent_audit_immutable"],
        ]),
      ]);

    expect(tables.rows).toHaveLength(6);
    expect(tables.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(
      true,
    );
    expect(new Set(functions.rows.map((row) => row.proname))).toEqual(
      new Set([
        "hermes_current_user_id",
        "hermes_audit_hash",
        "hermes_audit_before_insert",
        "hermes_audit_immutable",
        "hermes_verify_audit_chain",
        "hermes_public_issuer_key",
        "hermes_public_issuer_key_for_fragment",
        "hermes_public_agent",
        "hermes_public_agent_by_did",
      ]),
    );
    expect(role.rows).toEqual([
      { rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolsuper: false },
    ]);
    expect(publicCreate.rows).toEqual([{ count: 0 }]);
    expect(schemaPrivilege.rows).toEqual([{ can_create: false }]);
    expect(ownedObjects.rows).toEqual([{ count: 0 }]);
    expect(new Set(triggers.rows.map((row) => row.tgname))).toEqual(
      new Set(["agent_audit_before_insert", "agent_audit_immutable"]),
    );
  });

  it("enforces one membership per user and nonnegative agent spend caps", async () => {
    const duplicateUser = `duplicate-${suffix()}`;
    await pool.query(
      "INSERT INTO org_members (organization_id, user_id, role) VALUES ($1, $2, 'viewer')",
      [fixtures.organizationId, duplicateUser],
    );
    await expectSqlState(
      () =>
        pool.query(
          "INSERT INTO org_members (organization_id, user_id, role) VALUES ($1, $2, 'viewer')",
          [fixtures.otherOrganizationId, duplicateUser],
        ),
      "23505",
    );
    await expectSqlState(
      () =>
        pool.query(
          `INSERT INTO agents (
            organization_id, slug, did, name, role, risk, scopes, spend_cap_cents,
            credential_id, credential_jws, issued_at, expires_at, created_by
          ) VALUES ($1, $2, $3, 'Valid name', 'Valid role', 'low', ARRAY['catalog.read']::text[], -1,
            $4, 'signed-credential', now(), now() + interval '1 day', 'integration-test')`,
          [
            fixtures.organizationId,
            `invalid-${suffix()}`,
            `did:web:integration:invalid:${suffix()}`,
            `credential-invalid-${suffix()}`,
          ],
        ),
      "23514",
    );
  });

  it("enforces the allowed agent scope constraint", async () => {
    await expectSqlState(
      () =>
        pool.query(
          `INSERT INTO agents (
            organization_id, slug, did, name, role, risk, scopes, spend_cap_cents,
            credential_id, credential_jws, issued_at, expires_at, created_by
          ) VALUES ($1, $2, $3, 'Valid name', 'Valid role', 'low', ARRAY['not.allowed']::text[], 0,
            $4, 'signed-credential', now(), now() + interval '1 day', 'integration-test')`,
          [
            fixtures.organizationId,
            `invalid-scope-${suffix()}`,
            `did:web:integration:invalid-scope:${suffix()}`,
            `credential-invalid-scope-${suffix()}`,
          ],
        ),
      "23514",
    );
  });

  it("denies reads when the verified-user claim is missing", async () => {
    const count = await withAppUser(pool, "", async (client) => {
      const result = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM agents",
      );
      return result.rows[0]!.count;
    });

    expect(count).toBe(0);
  });

  it("denies cross-tenant reads through the hermes_app role", async () => {
    const visible = await withAppUser(pool, fixtures.viewerId, async (client) => {
      const own = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM agents WHERE organization_id = $1",
        [fixtures.organizationId],
      );
      const other = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM agents WHERE organization_id = $1",
        [fixtures.otherOrganizationId],
      );
      return { other: other.rows[0]!.count, own: own.rows[0]!.count };
    });

    expect(visible).toEqual({ other: 0, own: 1 });
  });

  it("denies viewer mutations and allows owner and admin mutations through the app role", async () => {
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.viewerId, (client) =>
          insertAgent(client, fixtures.organizationId, `viewer-${suffix()}`),
        ),
      "42501",
    );

    const ownerAgentId = await withAppUser(pool, fixtures.ownerId, (client) =>
      insertAgent(client, fixtures.organizationId, `owner-${suffix()}`),
    );
    const adminAgentId = await withAppUser(pool, fixtures.adminId, (client) =>
      insertAgent(client, fixtures.organizationId, `admin-${suffix()}`),
    );
    expect(ownerAgentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(adminAgentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("serializes concurrent audit appends into one valid organization chain", async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        withAppUser(pool, fixtures.adminId, (client) =>
          insertAudit(client, fixtures.organizationId, `concurrent-${index}`),
        ),
      ),
    );
    await withAppUser(pool, fixtures.adminId, (client) =>
      insertAudit(client, fixtures.organizationId, "after-concurrent"),
    );

    const [chainRows, chainState] = await Promise.all([
      pool.query<{ chain_position: string }>(
        "SELECT chain_position FROM agent_audit_logs WHERE organization_id = $1 ORDER BY chain_position",
        [fixtures.organizationId],
      ),
      pool.query<{ forks: number; heads: number; roots: number }>(
        `WITH audit AS (
          SELECT * FROM agent_audit_logs WHERE organization_id = $1
        )
        SELECT
          (SELECT count(*)::int FROM audit WHERE prev_hash IS NULL) AS roots,
          (SELECT count(*)::int FROM audit a WHERE NOT EXISTS (SELECT 1 FROM audit child WHERE child.prev_hash = a.hash)) AS heads,
          (SELECT count(*)::int FROM (SELECT prev_hash FROM audit WHERE prev_hash IS NOT NULL GROUP BY prev_hash HAVING count(*) > 1) forks) AS forks`,
        [fixtures.organizationId],
      ),
    ]);
    expect(chainRows.rows.map((row) => row.chain_position)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    expect(chainState.rows).toEqual([{ forks: 0, heads: 1, roots: 1 }]);

    const result = await withAppUser(pool, fixtures.adminId, (client) =>
      client.query<{ checked: string; valid: boolean }>(
        "SELECT valid, checked FROM hermes_verify_audit_chain($1)",
        [fixtures.organizationId],
      ),
    );
    expect(result.rows[0]).toMatchObject({ checked: "7", valid: true });
  }, 15_000);

  it("blocks normal-role audit mutations without assuming an update error", async () => {
    const audit = await pool.query<{ id: string; summary: string }>(
      "SELECT id, summary FROM agent_audit_logs WHERE organization_id = $1 ORDER BY id ASC LIMIT 1",
      [fixtures.organizationId],
    );
    const auditRow = audit.rows[0]!;

    const update = await withAppUser(pool, fixtures.adminId, (client) =>
      client.query("UPDATE agent_audit_logs SET summary = 'changed' WHERE id = $1", [auditRow.id]),
    );
    expect(update.rowCount).toBe(0);
    const unchanged = await pool.query<{ summary: string }>(
      "SELECT summary FROM agent_audit_logs WHERE id = $1",
      [auditRow.id],
    );
    expect(unchanged.rows).toEqual([{ summary: auditRow.summary }]);

    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query("DELETE FROM agent_audit_logs WHERE id = $1", [auditRow.id]),
        ),
      "42501",
    );

    await expectSqlState(
      () =>
        pool.query("UPDATE agent_audit_logs SET summary = 'changed' WHERE id = $1", [auditRow.id]),
      "P0001",
    );
    await expectSqlState(
      () => pool.query("DELETE FROM agent_audit_logs WHERE id = $1", [auditRow.id]),
      "P0001",
    );
  });

  it("rolls back all agent, key, and audit writes after a failure", async () => {
    const label = `rollback-${suffix()}`;

    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, async (client) => {
          const agentId = await insertAgent(client, fixtures.organizationId, label);
          await client.query(
            `INSERT INTO agent_keys (
              agent_id, organization_id, key_fragment, public_jwk, thumbprint,
              ciphertext, iv, wrapped_dek, kek_version, encryption_algorithm
            ) VALUES ($1, $2, 'key-1', '{}'::jsonb, 'thumbprint', '\\x01'::bytea, '\\x02'::bytea,
              '\\x03'::bytea, 'v1', 'A256GCM')`,
            [agentId, fixtures.organizationId],
          );
          await insertAudit(client, fixtures.organizationId, label);
          await client.query("SELECT 1 / 0");
        }),
      "22012",
    );

    const remaining = await pool.query<{ agents: string; audits: string; keys: string }>(
      `SELECT
        (SELECT count(*) FROM agents WHERE slug = $1)::text AS agents,
        (SELECT count(*) FROM agent_keys WHERE key_fragment = 'key-1')::text AS keys,
        (SELECT count(*) FROM agent_audit_logs WHERE action = $2)::text AS audits`,
      [`agent-${label}`, `audit.${label}`],
    );
    expect(remaining.rows[0]).toEqual({ agents: "0", audits: "0", keys: "0" });
  });
});
