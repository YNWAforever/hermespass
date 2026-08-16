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
  agentId: string;
  organizationId: string;
  otherAgentId: string;
  otherOrganizationId: string;
  ownerId: string;
  viewerId: string;
};

const migrationPaths = [
  join(process.cwd(), "drizzle", "0000_low_human_robot.sql"),
  join(process.cwd(), "drizzle", "0001_phase1_security_hardening.sql"),
];

function suffix(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

type HermesAppState = "absent" | "safe" | "privileged" | "contaminated";

async function resetMigrationFixture(pool: Pool, hermesAppState: HermesAppState): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query("DROP ROLE IF EXISTS hermes_parent");
    await client.query("DROP ROLE IF EXISTS hermes_app");
    await client.query("DROP ROLE IF EXISTS migration_owner");
    await client.query("CREATE ROLE migration_owner LOGIN CREATEROLE");
    await client.query("ALTER SCHEMA public OWNER TO migration_owner");
    await client.query("GRANT CREATE ON SCHEMA public TO PUBLIC");

    if (hermesAppState !== "absent") {
      if (hermesAppState === "privileged") {
        await client.query("CREATE ROLE hermes_app LOGIN BYPASSRLS CREATEDB CREATEROLE");
      } else {
        await client.query("CREATE ROLE hermes_app NOLOGIN INHERIT");
        await client.query("GRANT hermes_app TO migration_owner WITH ADMIN OPTION");
        if (hermesAppState === "contaminated") {
          await client.query("CREATE ROLE hermes_parent NOLOGIN");
          await client.query("GRANT hermes_parent TO hermes_app");
        }
      }
      await client.query("GRANT CREATE ON SCHEMA public TO hermes_app");
    }
  } finally {
    client.release();
  }
}

async function applyMigration(pool: Pool, paths = migrationPaths): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SET ROLE migration_owner");
    for (const migrationPath of paths) {
      const migration = await readFile(migrationPath, "utf8");
      await client.query("BEGIN");
      try {
        for (const statement of migration.split("--> statement-breakpoint")) {
          const sql = statement.trim();
          if (sql) await client.query(sql);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    throw error;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
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

async function insertAgentKey(
  client: SqlClient,
  agentId: string,
  organizationId: string,
  fragment: string,
  status: "active" | "revoked" = "active",
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO agent_keys (
      agent_id, organization_id, key_fragment, public_jwk, thumbprint,
      ciphertext, iv, wrapped_dek, kek_version, encryption_algorithm, status, revoked_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5, '\\x01'::bytea, '\\x02'::bytea,
      '\\x03'::bytea, 'v1', 'A256GCM+A256KW', $6::key_status,
      CASE WHEN $6::text = 'revoked' THEN now() ELSE NULL END)
    RETURNING id`,
    [
      agentId,
      organizationId,
      fragment,
      JSON.stringify({ kty: "OKP", crv: "Ed25519", x: fragment }),
      `thumbprint-${fragment}`,
      status,
    ],
  );
  return result.rows[0]!.id;
}

async function expectSqlState(operation: () => Promise<unknown>, code: string): Promise<void> {
  await expect(operation()).rejects.toMatchObject({ code });
}

dbTest("PostgreSQL migration owner controls", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("fails closed and rolls back when a pre-existing app role has privileged attributes", async () => {
    await resetMigrationFixture(pool, "privileged");

    await expect(applyMigration(pool)).rejects.toThrow("unsafe pre-existing hermes_app role");

    const [role, tables] = await Promise.all([
      pool.query(
        "SELECT rolsuper, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'hermes_app'",
      ),
      pool.query("SELECT to_regclass('public.agents') AS agents"),
    ]);
    expect(role.rows).toEqual([{ rolsuper: false, rolreplication: false, rolbypassrls: true }]);
    expect(tables.rows).toEqual([{ agents: null }]);
  });

  it("fails closed when hermes_app can SET ROLE into an inherited parent", async () => {
    await resetMigrationFixture(pool, "contaminated");

    await expect(applyMigration(pool)).rejects.toThrow(
      "unsafe pre-existing hermes_app role membership",
    );

    const memberships = await pool.query<{ parent: string }>(
      `SELECT parent.rolname AS parent
       FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles parent ON parent.oid = membership.roleid
       WHERE member.rolname = 'hermes_app'`,
    );
    expect(memberships.rows).toEqual([{ parent: "hermes_parent" }]);
  });

  it.each(["absent", "safe"] as const)(
    "applies under migration_owner when hermes_app is %s",
    async (hermesAppState) => {
      await resetMigrationFixture(pool, hermesAppState);
      await applyMigration(pool);

      const role = await pool.query(
        "SELECT rolcanlogin, rolsuper, rolreplication, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit FROM pg_roles WHERE rolname = 'hermes_app'",
      );
      expect(role.rows).toEqual([
        {
          rolcanlogin: true,
          rolsuper: false,
          rolreplication: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
        },
      ]);
    },
  );

  it("appends and verifies an audit chain when 0000 creates the app role", async () => {
    await resetMigrationFixture(pool, "absent");
    await applyMigration(pool);
    const organizationId = crypto.randomUUID();
    const adminId = `fresh-admin-${suffix()}`;
    await pool.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Fresh organization', $2)",
      [organizationId, `fresh-${suffix()}`],
    );
    await pool.query(
      "INSERT INTO org_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [organizationId, adminId],
    );

    await withAppUser(pool, adminId, (client) => insertAudit(client, organizationId, "fresh-1"));
    await withAppUser(pool, adminId, (client) => insertAudit(client, organizationId, "fresh-2"));

    const [positions, verification] = await Promise.all([
      pool.query<{ chain_position: string }>(
        "SELECT chain_position FROM agent_audit_logs WHERE organization_id = $1 ORDER BY chain_position",
        [organizationId],
      ),
      withAppUser(pool, adminId, (client) =>
        client.query<{ checked: string; valid: boolean }>(
          "SELECT checked, valid FROM hermes_verify_audit_chain($1)",
          [organizationId],
        ),
      ),
    ]);
    expect(positions.rows).toEqual([{ chain_position: "1" }, { chain_position: "2" }]);
    expect(verification.rows).toEqual([{ checked: "2", valid: true }]);
  });

  it("preserves pre-0001 audit hashes while new rows use the canonical version", async () => {
    await resetMigrationFixture(pool, "safe");
    await applyMigration(pool, [migrationPaths[0]!]);
    const organizationId = crypto.randomUUID();
    const adminId = `legacy-admin-${suffix()}`;
    await pool.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Legacy organization', $2)",
      [organizationId, `legacy-${suffix()}`],
    );
    await pool.query(
      "INSERT INTO org_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [organizationId, adminId],
    );
    await withAppUser(pool, adminId, async (client) => {
      await client.query("SET LOCAL TIME ZONE 'Asia/Hong_Kong'");
      await insertAudit(client, organizationId, "legacy-v2");
    });
    const before = await pool.query<{ hash: string }>(
      "SELECT encode(hash, 'hex') AS hash FROM agent_audit_logs WHERE organization_id = $1",
      [organizationId],
    );

    await applyMigration(pool, [migrationPaths[1]!]);

    const after = await pool.query<{ hash: string; hash_version: number }>(
      "SELECT encode(hash, 'hex') AS hash, hash_version FROM agent_audit_logs WHERE organization_id = $1",
      [organizationId],
    );
    const verification = await withAppUser(pool, adminId, async (client) => {
      await client.query("SET LOCAL TIME ZONE 'Asia/Hong_Kong'");
      return client.query<{ checked: string; valid: boolean }>(
        "SELECT checked, valid FROM hermes_verify_audit_chain($1)",
        [organizationId],
      );
    });

    expect(after.rows).toEqual([{ hash: before.rows[0]!.hash, hash_version: 2 }]);
    expect(verification.rows).toEqual([{ checked: "1", valid: true }]);
  });
});

dbTest("PostgreSQL identity and audit controls", () => {
  let pool: Pool;
  let fixtures: Fixtures;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 12 });
    await resetMigrationFixture(pool, "safe");
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
    const agentId = await insertAgent(pool, organizationId, `seed-${suffix()}`);
    const otherAgentId = await insertAgent(pool, otherOrganizationId, `other-${suffix()}`);

    fixtures = {
      adminId,
      agentId,
      organizationId,
      otherAgentId,
      otherOrganizationId,
      ownerId,
      viewerId,
    };
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
            "hermes_audit_hash_v3",
            "hermes_audit_before_insert",
            "hermes_audit_immutable",
            "hermes_verify_audit_chain",
            "hermes_public_issuer_key",
            "hermes_public_issuer_key_for_fragment",
            "hermes_public_issuer_keys",
            "hermes_public_agent",
            "hermes_public_agent_by_did",
            "hermes_revoke_agent",
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
        "hermes_audit_hash_v3",
        "hermes_audit_before_insert",
        "hermes_audit_immutable",
        "hermes_verify_audit_chain",
        "hermes_public_issuer_key",
        "hermes_public_issuer_key_for_fragment",
        "hermes_public_issuer_keys",
        "hermes_public_agent",
        "hermes_public_agent_by_did",
        "hermes_revoke_agent",
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

  it("rejects cross-tenant agent key and audit parent references on insert and update", async () => {
    await expectSqlState(
      () =>
        insertAgentKey(
          pool,
          fixtures.otherAgentId,
          fixtures.organizationId,
          `cross-insert-${suffix()}`,
        ),
      "23503",
    );

    const keyId = await insertAgentKey(
      pool,
      fixtures.agentId,
      fixtures.organizationId,
      `valid-${suffix()}`,
    );
    await expectSqlState(
      () =>
        pool.query("UPDATE agent_keys SET agent_id = $1 WHERE id = $2", [
          fixtures.otherAgentId,
          keyId,
        ]),
      "23503",
    );

    await expectSqlState(
      () =>
        pool.query(
          `INSERT INTO agent_audit_logs (
            organization_id, agent_id, actor_type, actor_id, action, summary
          ) VALUES ($1, $2, 'user', 'integration-admin', 'cross.audit', 'cross tenant')`,
          [fixtures.organizationId, fixtures.otherAgentId],
        ),
      "23503",
    );

    await insertAudit(pool, fixtures.organizationId, `immutable-${suffix()}`);
    const audit = await pool.query<{ id: string }>(
      "SELECT id FROM agent_audit_logs WHERE organization_id = $1 ORDER BY id DESC LIMIT 1",
      [fixtures.organizationId],
    );
    await expectSqlState(
      () =>
        pool.query("UPDATE agent_audit_logs SET agent_id = $1 WHERE id = $2", [
          fixtures.otherAgentId,
          audit.rows[0]!.id,
        ]),
      "P0001",
    );
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
    const before = await pool.query<{ maximum: string }>(
      "SELECT coalesce(max(chain_position), 0)::text AS maximum FROM agent_audit_logs WHERE organization_id = $1",
      [fixtures.organizationId],
    );
    const initialMaximum = Number(before.rows[0]!.maximum);

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
    expect(chainRows.rows.map((row) => Number(row.chain_position))).toEqual(
      Array.from({ length: initialMaximum + 7 }, (_, index) => index + 1),
    );
    expect(chainState.rows).toEqual([{ forks: 0, heads: 1, roots: 1 }]);

    const result = await withAppUser(pool, fixtures.adminId, (client) =>
      client.query<{ checked: string; valid: boolean }>(
        "SELECT valid, checked FROM hermes_verify_audit_chain($1)",
        [fixtures.organizationId],
      ),
    );
    expect(result.rows[0]).toMatchObject({
      checked: String(initialMaximum + 7),
      valid: true,
    });
  }, 15_000);

  it("verifies audit hashes across different session timezones", async () => {
    await withAppUser(pool, fixtures.adminId, async (client) => {
      await client.query("SET LOCAL TIME ZONE 'Asia/Hong_Kong'");
      await insertAudit(client, fixtures.organizationId, `timezone-${suffix()}`);
    });

    const result = await withAppUser(pool, fixtures.adminId, async (client) => {
      await client.query("SET LOCAL TIME ZONE 'America/New_York'");
      return client.query<{ valid: boolean }>("SELECT valid FROM hermes_verify_audit_chain($1)", [
        fixtures.organizationId,
      ]);
    });

    expect(result.rows).toEqual([{ valid: true }]);
  });

  it("publishes only the active agent key while retaining revoked-agent DID history", async () => {
    const agentId = await insertAgent(pool, fixtures.organizationId, `public-key-${suffix()}`);
    await insertAgentKey(pool, agentId, fixtures.organizationId, "old-key", "revoked");
    await insertAgentKey(pool, agentId, fixtures.organizationId, "active-key");

    const active = await pool.query<{ key: string | null }>(
      "SELECT public_jwk->>'x' AS key FROM hermes_public_agent((SELECT slug FROM agents WHERE id = $1))",
      [agentId],
    );
    expect(active.rows).toEqual([{ key: "active-key" }]);

    await pool.query("UPDATE agents SET status = 'revoked' WHERE id = $1", [agentId]);
    await pool.query(
      "UPDATE agent_keys SET status = 'revoked', revoked_at = now() WHERE agent_id = $1",
      [agentId],
    );
    const historical = await pool.query<{ key: string | null }>(
      "SELECT public_jwk->>'x' AS key FROM hermes_public_agent((SELECT slug FROM agents WHERE id = $1))",
      [agentId],
    );
    expect(historical.rows).toEqual([{ key: "active-key" }]);
  });

  it("keeps historical issuer verification methods publicly resolvable", async () => {
    const did = `did:web:issuer-${suffix()}.example`;
    await pool.query(
      `INSERT INTO issuer_keys (
        did, key_fragment, public_jwk, thumbprint, ciphertext, iv, wrapped_dek,
        kek_version, encryption_algorithm, status, revoked_at
      ) VALUES
        ($1, 'issuer-old', '{"kty":"OKP","crv":"Ed25519","x":"old"}'::jsonb,
          'old-thumbprint', '\\x01', '\\x02', '\\x03', 'v1', 'A256GCM+A256KW', 'revoked', now()),
        ($1, 'issuer-current', '{"kty":"OKP","crv":"Ed25519","x":"current"}'::jsonb,
          'current-thumbprint', '\\x01', '\\x02', '\\x03', 'v1', 'A256GCM+A256KW', 'active', null)`,
      [did],
    );

    const keys = await pool.query<{ key_fragment: string }>(
      "SELECT key_fragment FROM hermes_public_issuer_keys($1) ORDER BY key_fragment",
      [did],
    );
    expect(keys.rows).toEqual([{ key_fragment: "issuer-current" }, { key_fragment: "issuer-old" }]);
  });

  it("makes concurrent revocation idempotent and preserves the winner metadata", async () => {
    const agentId = await insertAgent(pool, fixtures.organizationId, `revoke-${suffix()}`);
    await insertAgentKey(pool, agentId, fixtures.organizationId, `revoke-key-${suffix()}`);
    const contenders = [fixtures.adminId, fixtures.ownerId];

    const results = await Promise.all(
      contenders.map(async (actorId) => {
        const result = await withAppUser(pool, actorId, (client) =>
          client.query<{ changed: boolean }>(
            "SELECT changed FROM hermes_revoke_agent($1, $2, $3)",
            [agentId, fixtures.organizationId, actorId],
          ),
        );
        return { actorId, changed: result.rows[0]!.changed };
      }),
    );

    expect(results.map(({ changed }) => changed).sort()).toEqual([false, true]);
    const winner = results.find(({ changed }) => changed)!.actorId;
    const state = await pool.query<{
      audit_actor: string;
      audit_count: number;
      key_status: string;
      revoked_by: string;
    }>(
      `SELECT
        a.revoked_by,
        (SELECT status::text FROM agent_keys WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 1) AS key_status,
        (SELECT count(*)::int FROM agent_audit_logs l WHERE l.agent_id = a.id AND l.action = 'passport.revoked') AS audit_count,
        (SELECT actor_id FROM agent_audit_logs l WHERE l.agent_id = a.id AND l.action = 'passport.revoked') AS audit_actor
       FROM agents a WHERE a.id = $1`,
      [agentId],
    );
    expect(state.rows).toEqual([
      { audit_actor: winner, audit_count: 1, key_status: "revoked", revoked_by: winner },
    ]);
  });

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
