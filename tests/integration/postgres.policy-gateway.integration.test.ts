import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;

if (databaseRequired) {
  describe("PostgreSQL policy gateway test configuration", () => {
    it("requires DATABASE_URL_TEST", () => {
      expect(databaseUrl, "DATABASE_URL_TEST is required for bun run test:db").toBeTruthy();
    });
  });
}

type SqlClient = Pool | PoolClient;

type Fixtures = {
  adminId: string;
  agentId: string;
  assignedReviewerId: string;
  externalKeyId: string;
  organizationId: string;
  otherAgentId: string;
  otherExternalKeyId: string;
  otherOrganizationId: string;
  otherOwnerId: string;
  ownerId: string;
  unassignedAdminId: string;
  viewerId: string;
};

const phase0Migration = join(process.cwd(), "drizzle", "0000_low_human_robot.sql");
const phase1Migration = join(process.cwd(), "drizzle", "0001_phase1_security_hardening.sql");
const phase2Migration = join(process.cwd(), "drizzle", "0002_policy_gateway.sql");
const availableMigrations = [phase0Migration, phase1Migration];
if (existsSync(phase2Migration)) availableMigrations.push(phase2Migration);

function suffix(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

async function resetMigrationFixture(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query("DROP ROLE IF EXISTS hermes_app");
    await client.query("DROP ROLE IF EXISTS migration_owner");
    await client.query("CREATE ROLE migration_owner LOGIN CREATEROLE");
    await client.query("ALTER SCHEMA public OWNER TO migration_owner");
    await client.query("GRANT CREATE ON SCHEMA public TO PUBLIC");
    await client.query("CREATE ROLE hermes_app NOLOGIN INHERIT");
    await client.query("GRANT hermes_app TO migration_owner WITH ADMIN OPTION");
    await client.query("GRANT CREATE ON SCHEMA public TO hermes_app");
  } finally {
    client.release();
  }
}

async function applyMigrations(pool: Pool, paths: string[]): Promise<void> {
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
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

async function withAppTransaction<T>(
  pool: Pool,
  setup: (client: PoolClient) => Promise<void>,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await setup(client);
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

async function withAppUser<T>(
  pool: Pool,
  userId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withAppTransaction(
    pool,
    async (client) => {
      await client.query("SELECT set_config('hermes.user_id', $1, true)", [userId]);
    },
    operation,
  );
}

async function withVerifiedAgent<T>(
  pool: Pool,
  agentId: string,
  organizationId: string,
  keyId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withAppTransaction(
    pool,
    async (client) => {
      await client.query("SELECT public.hermes_set_verified_agent_claim($1, $2, $3)", [
        agentId,
        organizationId,
        keyId,
      ]);
    },
    operation,
  );
}

async function expectSqlState(operation: () => Promise<unknown>, code: string): Promise<void> {
  await expect(operation()).rejects.toMatchObject({ code });
}

async function insertAgent(
  client: SqlClient,
  organizationId: string,
  label: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.agents (
      organization_id, slug, did, name, role, risk, scopes, spend_cap_cents,
      credential_id, credential_jws, issued_at, expires_at, created_by
    ) VALUES (
      $1, $2, $3, 'Policy agent', 'operator', 'low',
      ARRAY['catalog.read', 'checkout.external']::text[], 1000000,
      $4, 'signed-credential', now(), now() + interval '1 day', 'integration-test'
    ) RETURNING id`,
    [organizationId, `agent-${label}`, `did:web:policy:${label}`, `credential-${label}`],
  );
  return result.rows[0]!.id;
}

async function insertExternalKey(
  client: SqlClient,
  agentId: string,
  organizationId: string,
  label: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.agent_keys (
      agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status
    ) VALUES (
      $1, $2, $3, $4::jsonb, $5, 'external', 'active'
    ) RETURNING id`,
    [
      agentId,
      organizationId,
      label,
      JSON.stringify({ kty: "OKP", crv: "Ed25519", x: label }),
      `thumbprint-${label}`,
    ],
  );
  return result.rows[0]!.id;
}

async function insertPolicy(
  client: SqlClient,
  organizationId: string,
  agentId: string,
  reviewerId: string,
  version = 1,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.agent_policies (
      organization_id, agent_id, version, currency,
      per_transaction_limit_cents, daily_limit_cents, monthly_limit_cents,
      approval_threshold_cents, mcc_allowlist, mcc_required,
      assigned_reviewer_user_id, is_active, created_by_user_id
    ) VALUES (
      $1, $2, $3, 'HKD', 50000, 100000, 500000, 20000,
      ARRAY['5411', '5732']::text[], true, $4, true,
      COALESCE(public.hermes_current_user_id(), $4)
    ) RETURNING id`,
    [organizationId, agentId, version, reviewerId],
  );
  return result.rows[0]!.id;
}

async function insertGatewayRequest(
  client: SqlClient,
  organizationId: string,
  agentId: string,
  keyId: string,
  nonce: string,
  decision: "allow" | "deny" | "hold" = "hold",
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.gateway_requests (
      organization_id, agent_id, key_id, nonce, request_digest, payload_digest,
      signature_digest, action_version, tool, summary, justification,
      amount_cents, currency, merchant_category_code, signed_at,
      decision, current_decision, reason_code, reason, policy_version,
      decided_at, current_result_updated_at, authorized_at, authorization_expires_at
    ) VALUES (
      $1, $2, $3, $4,
      decode(repeat('ab', 32), 'hex'), decode(repeat('cd', 32), 'hex'),
      decode(repeat('ef', 32), 'hex'), '1', 'checkout.external',
      'Safe checkout summary', 'Integration justification', 12000, 'HKD', '5411', now(),
      $5::public.gateway_decision, $5::public.gateway_decision,
      'INTEGRATION_DECISION', 'Integration decision', 1,
      now(), now(), CASE WHEN $5::text = 'allow' THEN now() ELSE NULL END,
      CASE WHEN $5::text = 'allow' THEN now() + interval '5 minutes' ELSE NULL END
    ) RETURNING id`,
    [organizationId, agentId, keyId, nonce, decision],
  );
  return result.rows[0]!.id;
}

async function insertApproval(
  client: SqlClient,
  organizationId: string,
  agentId: string,
  requestId: string,
  reviewerId: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.pending_approvals (
      organization_id, agent_id, gateway_request_id, assigned_reviewer_user_id,
      status, expires_at, telegram_delivery_state
    ) VALUES ($1, $2, $3, $4, 'pending', now() + interval '4 hours', 'not_requested')
    RETURNING id`,
    [organizationId, agentId, requestId, reviewerId],
  );
  return result.rows[0]!.id;
}

dbTest("PostgreSQL Phase 2 additive upgrade", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("upgrades existing 0000/0001 rows without rewriting legacy keys or audit hashes", async () => {
    await resetMigrationFixture(pool);
    await applyMigrations(pool, [phase0Migration, phase1Migration]);

    const organizationId = crypto.randomUUID();
    const adminId = `upgrade-admin-${suffix()}`;
    await pool.query(
      "INSERT INTO public.organizations (id, name, slug) VALUES ($1, 'Upgrade org', $2)",
      [organizationId, `upgrade-${suffix()}`],
    );
    await pool.query(
      "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [organizationId, adminId],
    );
    const agentId = await insertAgent(pool, organizationId, `upgrade-${suffix()}`);
    const legacyKey = await pool.query<{ id: string }>(
      `INSERT INTO public.agent_keys (
        agent_id, organization_id, key_fragment, public_jwk, thumbprint,
        ciphertext, iv, wrapped_dek, kek_version, encryption_algorithm
      ) VALUES (
        $1, $2, 'legacy', '{"kty":"OKP","crv":"Ed25519","x":"legacy"}',
        'legacy-thumbprint', '\\x01', '\\x02', '\\x03', 'v1', 'A256GCM+A256KW'
      ) RETURNING id`,
      [agentId, organizationId],
    );
    await pool.query(
      `INSERT INTO public.agent_audit_logs (
        organization_id, agent_id, actor_type, actor_id, action, summary
      ) VALUES ($1, $2, 'user', $3, 'policy.upgrade-baseline', 'Upgrade baseline')`,
      [organizationId, agentId, adminId],
    );
    const auditBefore = await pool.query<{ hash: string }>(
      "SELECT encode(hash, 'hex') AS hash FROM public.agent_audit_logs WHERE organization_id = $1",
      [organizationId],
    );

    if (existsSync(phase2Migration)) await applyMigrations(pool, [phase2Migration]);

    const [keyAfter, auditAfter, verification] = await Promise.all([
      pool.query(
        `SELECT custody::text, ciphertext IS NOT NULL AS has_ciphertext
         FROM public.agent_keys WHERE id = $1`,
        [legacyKey.rows[0]!.id],
      ),
      pool.query<{ hash: string }>(
        "SELECT encode(hash, 'hex') AS hash FROM public.agent_audit_logs WHERE organization_id = $1",
        [organizationId],
      ),
      withAppUser(pool, adminId, (client) =>
        client.query<{ valid: boolean }>("SELECT valid FROM public.hermes_verify_audit_chain($1)", [
          organizationId,
        ]),
      ),
    ]);

    expect(keyAfter.rows).toEqual([{ custody: "legacy_encrypted", has_ciphertext: true }]);
    expect(auditAfter.rows).toEqual(auditBefore.rows);
    expect(verification.rows).toEqual([{ valid: true }]);
  });
});

dbTest("PostgreSQL Phase 2 policy gateway controls", () => {
  let pool: Pool;
  let fixtures: Fixtures;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 16 });
    await resetMigrationFixture(pool);
    await applyMigrations(pool, availableMigrations);

    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const ownerId = `owner-${suffix()}`;
    const adminId = `admin-${suffix()}`;
    const assignedReviewerId = `reviewer-${suffix()}`;
    const unassignedAdminId = `unassigned-${suffix()}`;
    const viewerId = `viewer-${suffix()}`;
    const otherOwnerId = `other-owner-${suffix()}`;

    await pool.query(
      `INSERT INTO public.organizations (id, name, slug) VALUES
        ($1, 'Policy org', $2), ($3, 'Other policy org', $4)`,
      [organizationId, `policy-${suffix()}`, otherOrganizationId, `other-policy-${suffix()}`],
    );
    await pool.query(
      `INSERT INTO public.org_members (
        organization_id, user_id, role, email_snapshot, name_snapshot
      ) VALUES
        ($1, $2, 'owner', 'owner@example.test', 'Owner'),
        ($1, $3, 'admin', 'admin@example.test', 'Admin'),
        ($1, $4, 'admin', 'reviewer@example.test', 'Assigned reviewer'),
        ($1, $5, 'admin', 'other-admin@example.test', 'Unassigned admin'),
        ($1, $6, 'viewer', 'viewer@example.test', 'Viewer'),
        ($7, $8, 'owner', 'other-owner@example.test', 'Other owner')`,
      [
        organizationId,
        ownerId,
        adminId,
        assignedReviewerId,
        unassignedAdminId,
        viewerId,
        otherOrganizationId,
        otherOwnerId,
      ],
    );
    const agentId = await insertAgent(pool, organizationId, `main-${suffix()}`);
    const otherAgentId = await insertAgent(pool, otherOrganizationId, `other-${suffix()}`);
    const externalKeyId = await insertExternalKey(
      pool,
      agentId,
      organizationId,
      `external-${suffix()}`,
    );
    const otherExternalKeyId = await insertExternalKey(
      pool,
      otherAgentId,
      otherOrganizationId,
      `other-external-${suffix()}`,
    );

    fixtures = {
      adminId,
      agentId,
      assignedReviewerId,
      externalKeyId,
      organizationId,
      otherAgentId,
      otherExternalKeyId,
      otherOrganizationId,
      otherOwnerId,
      ownerId,
      unassignedAdminId,
      viewerId,
    };
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("installs the complete forced-RLS substrate and a restricted runtime role", async () => {
    const tenantTables = [
      "agent_key_enrollments",
      "agent_policies",
      "gateway_requests",
      "pending_approvals",
      "telegram_link_tokens",
      "telegram_links",
    ];
    const [tables, role, routines, ddlPrivilege, runtimeOwnedTables] = await Promise.all([
      pool.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
        [tenantTables],
      ),
      pool.query(
        `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit
         FROM pg_roles WHERE rolname = 'hermes_app'`,
      ),
      pool.query<{ name: string; settings: string[] | null }>(
        `SELECT procedure.proname AS name, procedure.proconfig AS settings
         FROM pg_proc procedure
         JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
         WHERE namespace.nspname = 'public'
           AND procedure.proname = ANY($1::text[])
         ORDER BY procedure.proname`,
        [
          [
            "hermes_agent_key_enrollment_guard",
            "hermes_agent_policy_guard",
            "hermes_current_agent_id",
            "hermes_current_agent_key_id",
            "hermes_current_agent_organization_id",
            "hermes_gateway_request_guard",
            "hermes_has_org_role",
            "hermes_lock_approval_resolution",
            "hermes_lock_gateway_decision",
            "hermes_lock_policy_version",
            "hermes_next_policy_version",
            "hermes_pending_approval_guard",
            "hermes_set_verified_agent_claim",
            "hermes_telegram_link_guard",
            "hermes_telegram_link_token_guard",
          ],
        ],
      ),
      pool.query("SELECT has_schema_privilege('hermes_app', 'public', 'CREATE') AS can_create"),
      pool.query(
        `SELECT relation.relname
         FROM pg_class relation
         JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE relation.relnamespace = 'public'::regnamespace
           AND relation.relkind IN ('r', 'p')
           AND owner_role.rolname = 'hermes_app'`,
      ),
    ]);

    expect(tables.rows).toHaveLength(tenantTables.length);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect(role.rows).toEqual([
      {
        rolbypassrls: false,
        rolcanlogin: true,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolsuper: false,
      },
    ]);
    expect(routines.rows).toHaveLength(15);
    expect(
      routines.rows.every(({ settings }) =>
        settings?.includes("search_path=pg_catalog, public, pg_temp"),
      ),
    ).toBe(true);
    expect(ddlPrivilege.rows).toEqual([{ can_create: false }]);
    expect(runtimeOwnedTables.rows).toEqual([]);
  });

  it("enforces external-key custody and retains one active historical key per agent", async () => {
    const external = await pool.query(
      `SELECT custody::text, ciphertext, iv, wrapped_dek, kek_version, encryption_algorithm
       FROM public.agent_keys WHERE id = $1`,
      [fixtures.externalKeyId],
    );
    expect(external.rows).toEqual([
      {
        ciphertext: null,
        custody: "external",
        encryption_algorithm: null,
        iv: null,
        kek_version: null,
        wrapped_dek: null,
      },
    ]);

    await expectSqlState(
      () =>
        pool.query(
          `INSERT INTO public.agent_keys (
            agent_id, organization_id, key_fragment, public_jwk, thumbprint,
            custody, ciphertext, status
          ) VALUES ($1, $2, $3, '{}'::jsonb, $4, 'external', '\\x01', 'revoked')`,
          [
            fixtures.agentId,
            fixtures.organizationId,
            `bad-external-${suffix()}`,
            `bad-${suffix()}`,
          ],
        ),
      "23514",
    );
    await expectSqlState(
      () =>
        pool.query(
          `INSERT INTO public.agent_keys (
            agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status
          ) VALUES ($1, $2, $3, '{}'::jsonb, $4, 'legacy_encrypted', 'revoked')`,
          [fixtures.agentId, fixtures.organizationId, `bad-legacy-${suffix()}`, `bad-${suffix()}`],
        ),
      "23514",
    );
    await expectSqlState(
      () =>
        insertExternalKey(
          pool,
          fixtures.agentId,
          fixtures.organizationId,
          `second-active-${suffix()}`,
        ),
      "23505",
    );
  });

  it("keeps policy content immutable, versions unique, and reviewers owner/admin only", async () => {
    const policyId = await withAppUser(pool, fixtures.adminId, (client) =>
      insertPolicy(client, fixtures.organizationId, fixtures.agentId, fixtures.assignedReviewerId),
    );

    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.viewerId, (client) =>
          insertPolicy(client, fixtures.organizationId, fixtures.agentId, fixtures.ownerId, 2),
        ),
      "42501",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query(
            `INSERT INTO public.agent_policies (
              organization_id, agent_id, version, currency,
              per_transaction_limit_cents, daily_limit_cents, monthly_limit_cents,
              approval_threshold_cents, mcc_allowlist, mcc_required,
              assigned_reviewer_user_id, is_active, superseded_at, created_by_user_id
            ) VALUES (
              $1, $2, 2, 'HKD', 50000, 100000, 500000, 20000,
              ARRAY['5411', 'not-an-mcc']::text[], true,
              $3, false, now(), $4
            )`,
            [
              fixtures.organizationId,
              fixtures.agentId,
              fixtures.assignedReviewerId,
              fixtures.adminId,
            ],
          ),
        ),
      "23514",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          insertPolicy(client, fixtures.organizationId, fixtures.agentId, fixtures.viewerId, 2),
        ),
      "23514",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query(
            "UPDATE public.agent_policies SET daily_limit_cents = daily_limit_cents + 1 WHERE id = $1",
            [policyId],
          ),
        ),
      "P0001",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          insertPolicy(
            client,
            fixtures.organizationId,
            fixtures.agentId,
            fixtures.assignedReviewerId,
          ),
        ),
      "23505",
    );
  });

  it("denies cross-tenant and viewer mutations while allowing tenant reads", async () => {
    await insertPolicy(
      pool,
      fixtures.otherOrganizationId,
      fixtures.otherAgentId,
      fixtures.otherOwnerId,
    );

    const visible = await withAppUser(pool, fixtures.viewerId, async (client) => {
      const own = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.agent_policies WHERE organization_id = $1",
        [fixtures.organizationId],
      );
      const other = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.agent_policies WHERE organization_id = $1",
        [fixtures.otherOrganizationId],
      );
      return { other: other.rows[0]!.count, own: own.rows[0]!.count };
    });
    expect(visible).toEqual({ other: 0, own: 1 });

    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          insertPolicy(
            client,
            fixtures.otherOrganizationId,
            fixtures.otherAgentId,
            fixtures.otherOwnerId,
          ),
        ),
      "42501",
    );
  });

  it("requires a transaction-local verified-agent claim for agent gateway access", async () => {
    const requestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `seed-${suffix()}`,
    );
    await insertGatewayRequest(
      pool,
      fixtures.otherOrganizationId,
      fixtures.otherAgentId,
      fixtures.otherExternalKeyId,
      `other-${suffix()}`,
      "deny",
    );

    const missingClaim = await withAppTransaction(
      pool,
      async () => undefined,
      (client) =>
        client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM public.gateway_requests",
        ),
    );
    expect(missingClaim.rows).toEqual([{ count: 0 }]);
    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            insertGatewayRequest(
              client,
              fixtures.organizationId,
              fixtures.agentId,
              fixtures.externalKeyId,
              `missing-claim-${suffix()}`,
            ),
        ),
      "42501",
    );

    const claimed = await withVerifiedAgent(
      pool,
      fixtures.agentId,
      fixtures.organizationId,
      fixtures.externalKeyId,
      async (client) => {
        const own = await client.query<{ id: string }>(
          "SELECT id FROM public.gateway_requests WHERE id = $1",
          [requestId],
        );
        const other = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM public.gateway_requests WHERE organization_id = $1",
          [fixtures.otherOrganizationId],
        );
        return { other: other.rows[0]!.count, own: own.rows.length };
      },
    );
    expect(claimed).toEqual({ other: 0, own: 1 });

    const postTransaction = await withAppTransaction(
      pool,
      async () => undefined,
      (client) =>
        client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM public.gateway_requests",
        ),
    );
    expect(postTransaction.rows).toEqual([{ count: 0 }]);

    const fakeAgentId = crypto.randomUUID();
    const fakeOrganizationId = crypto.randomUUID();
    const fakeKeyId = crypto.randomUUID();
    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async (client) => {
            await client.query(
              "CREATE TEMP TABLE agents (id uuid, organization_id uuid) ON COMMIT DROP",
            );
            await client.query(
              `CREATE TEMP TABLE agent_keys (
                id uuid, agent_id uuid, organization_id uuid, custody text
              ) ON COMMIT DROP`,
            );
            await client.query("INSERT INTO pg_temp.agents VALUES ($1, $2)", [
              fakeAgentId,
              fakeOrganizationId,
            ]);
            await client.query("INSERT INTO pg_temp.agent_keys VALUES ($1, $2, $3, 'external')", [
              fakeKeyId,
              fakeAgentId,
              fakeOrganizationId,
            ]);
          },
          (client) =>
            client.query("SELECT public.hermes_set_verified_agent_claim($1, $2, $3)", [
              fakeAgentId,
              fakeOrganizationId,
              fakeKeyId,
            ]),
        ),
      "P0002",
    );
  });

  it("stores only hashed, expiring, single-use enrollment and Telegram tokens", async () => {
    const enrollmentHash = Buffer.alloc(32, 7);
    const telegramHash = Buffer.alloc(32, 9);

    const enrollment = await withAppUser(pool, fixtures.adminId, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO public.agent_key_enrollments (
          organization_id, agent_id, token_hash, expires_at, created_by_user_id
        ) VALUES ($1, $2, $3, now() + interval '15 minutes', $4) RETURNING id`,
        [fixtures.organizationId, fixtures.agentId, enrollmentHash, fixtures.adminId],
      ),
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query(
            `INSERT INTO public.agent_key_enrollments (
              organization_id, agent_id, token_hash, expires_at, created_by_user_id
            ) VALUES ($1, $2, $3, now() + interval '15 minutes', $4)`,
            [fixtures.organizationId, fixtures.agentId, enrollmentHash, fixtures.adminId],
          ),
        ),
      "23505",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query(
            `INSERT INTO public.agent_key_enrollments (
              organization_id, agent_id, token_hash, expires_at, created_by_user_id
            ) VALUES ($1, $2, decode('01', 'hex'), now() - interval '1 second', $3)`,
            [fixtures.organizationId, fixtures.agentId, fixtures.adminId],
          ),
        ),
      "23514",
    );

    const token = await withAppUser(pool, fixtures.assignedReviewerId, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO public.telegram_link_tokens (
          organization_id, user_id, token_hash, expires_at, created_by_user_id
        ) VALUES ($1, $2, $3, now() + interval '10 minutes', $2) RETURNING id`,
        [fixtures.organizationId, fixtures.assignedReviewerId, telegramHash],
      ),
    );
    const linked = await pool.query<{ id: string }>(
      `INSERT INTO public.telegram_links (
        organization_id, user_id, telegram_user_id, telegram_chat_id
      ) VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        fixtures.organizationId,
        fixtures.assignedReviewerId,
        Number(`8${Date.now().toString().slice(-9)}`),
        Number(`9${Date.now().toString().slice(-9)}`),
      ],
    );
    const viewerSecrets = await withAppUser(pool, fixtures.viewerId, async (client) => {
      const enrollments = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.agent_key_enrollments",
      );
      const links = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.telegram_links",
      );
      const tokens = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.telegram_link_tokens",
      );
      return {
        enrollments: enrollments.rows[0]!.count,
        links: links.rows[0]!.count,
        tokens: tokens.rows[0]!.count,
      };
    });
    expect(viewerSecrets).toEqual({ enrollments: 0, links: 0, tokens: 0 });
    await pool.query(
      `UPDATE public.agent_key_enrollments
       SET consumed_at = now(), consumed_key_id = $2 WHERE id = $1`,
      [enrollment.rows[0]!.id, fixtures.externalKeyId],
    );
    await pool.query(
      `UPDATE public.telegram_link_tokens
       SET consumed_at = now(), consumed_link_id = $2 WHERE id = $1`,
      [token.rows[0]!.id, linked.rows[0]!.id],
    );
    await expectSqlState(
      () =>
        pool.query("UPDATE public.agent_key_enrollments SET consumed_at = NULL WHERE id = $1", [
          enrollment.rows[0]!.id,
        ]),
      "P0001",
    );
    await expectSqlState(
      () =>
        pool.query("UPDATE public.telegram_link_tokens SET consumed_at = NULL WHERE id = $1", [
          token.rows[0]!.id,
        ]),
      "P0001",
    );

    const unsafeColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('agent_key_enrollments', 'telegram_link_tokens')
         AND column_name ~* '(plain|raw)_?token'`,
    );
    expect(unsafeColumns.rows).toEqual([]);
  });

  it("allows only the assigned reviewer or an organization owner to resolve holds", async () => {
    const deniedRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `not-a-hold-${suffix()}`,
      "deny",
    );
    await expectSqlState(
      () =>
        insertApproval(
          pool,
          fixtures.organizationId,
          fixtures.agentId,
          deniedRequestId,
          fixtures.assignedReviewerId,
        ),
      "23514",
    );

    const requestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `approval-${suffix()}`,
    );
    const approvalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      requestId,
      fixtures.assignedReviewerId,
    );

    const unassigned = await withAppUser(pool, fixtures.unassignedAdminId, (client) =>
      client.query(
        `UPDATE public.pending_approvals SET
          status = 'approved', resolution = 'allow', resolution_source = 'web',
          resolved_by_user_id = $1, resolved_at = now()
         WHERE id = $2`,
        [fixtures.unassignedAdminId, approvalId],
      ),
    );
    expect(unassigned.rowCount).toBe(0);

    const assigned = await withAppUser(pool, fixtures.assignedReviewerId, (client) =>
      client.query(
        `UPDATE public.pending_approvals SET
          status = 'approved', resolution = 'allow', resolution_source = 'web',
          resolved_by_user_id = $1, resolved_at = now()
         WHERE id = $2 AND status = 'pending'`,
        [fixtures.assignedReviewerId, approvalId],
      ),
    );
    expect(assigned.rowCount).toBe(1);
    const assignedGateway = await withAppUser(pool, fixtures.assignedReviewerId, (client) =>
      client.query(
        `UPDATE public.gateway_requests SET
          current_decision = 'allow', reason_code = 'REVIEWER_APPROVED',
          reason = 'Assigned reviewer approved', current_result_updated_at = now(),
          authorized_at = now(), authorization_expires_at = now() + interval '5 minutes'
         WHERE id = $1 AND current_decision = 'hold'`,
        [requestId],
      ),
    );
    expect(assignedGateway.rowCount).toBe(1);

    const demotedRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `demoted-reviewer-${suffix()}`,
    );
    const demotedApprovalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      demotedRequestId,
      fixtures.assignedReviewerId,
    );
    await pool.query(
      "UPDATE public.org_members SET role = 'viewer' WHERE organization_id = $1 AND user_id = $2",
      [fixtures.organizationId, fixtures.assignedReviewerId],
    );
    try {
      const demoted = await withAppUser(pool, fixtures.assignedReviewerId, (client) =>
        client.query(
          `UPDATE public.pending_approvals SET
            status = 'approved', resolution = 'allow', resolution_source = 'web',
            resolved_by_user_id = $1, resolved_at = now()
           WHERE id = $2 AND status = 'pending'`,
          [fixtures.assignedReviewerId, demotedApprovalId],
        ),
      );
      expect(demoted.rowCount).toBe(0);
    } finally {
      await pool.query(
        "UPDATE public.org_members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2",
        [fixtures.organizationId, fixtures.assignedReviewerId],
      );
    }

    const ownerRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `owner-approval-${suffix()}`,
    );
    const ownerApprovalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      ownerRequestId,
      fixtures.assignedReviewerId,
    );
    const owner = await withAppUser(pool, fixtures.ownerId, (client) =>
      client.query(
        `UPDATE public.pending_approvals SET
          status = 'denied', resolution = 'deny', resolution_source = 'owner_override',
          resolved_by_user_id = $1, resolved_at = now()
         WHERE id = $2 AND status = 'pending'`,
        [fixtures.ownerId, ownerApprovalId],
      ),
    );
    expect(owner.rowCount).toBe(1);
    const ownerGateway = await withAppUser(pool, fixtures.ownerId, (client) =>
      client.query(
        `UPDATE public.gateway_requests SET
          current_decision = 'deny', reason_code = 'OWNER_DENIED',
          reason = 'Organization owner denied', current_result_updated_at = now()
         WHERE id = $1 AND current_decision = 'hold'`,
        [ownerRequestId],
      ),
    );
    expect(ownerGateway.rowCount).toBe(1);
  });

  it("uses one per-agent transaction lock for policy allocation, gateway spend, and resolution", async () => {
    const lockAgentId = await insertAgent(pool, fixtures.organizationId, `lock-${suffix()}`);
    const lockKeyId = await insertExternalKey(
      pool,
      lockAgentId,
      fixtures.organizationId,
      `lock-key-${suffix()}`,
    );
    const first = await pool.connect();
    const contender = await pool.connect();

    try {
      await first.query("SET ROLE hermes_app");
      await first.query("BEGIN");
      await first.query("SELECT set_config('hermes.user_id', $1, true)", [fixtures.adminId]);
      const nextVersion = await first.query<{ version: number }>(
        "SELECT public.hermes_next_policy_version($1, $2) AS version",
        [lockAgentId, fixtures.organizationId],
      );
      expect(nextVersion.rows).toEqual([{ version: 1 }]);
      await insertPolicy(first, fixtures.organizationId, lockAgentId, fixtures.assignedReviewerId);

      await contender.query("SET ROLE hermes_app");
      await contender.query("BEGIN");
      await contender.query("SET LOCAL lock_timeout = '100ms'");
      await contender.query("SELECT public.hermes_set_verified_agent_claim($1, $2, $3)", [
        lockAgentId,
        fixtures.organizationId,
        lockKeyId,
      ]);
      await expectSqlState(
        () => contender.query("SELECT public.hermes_lock_gateway_decision($1)", [lockAgentId]),
        "55P03",
      );
      await contender.query("ROLLBACK");

      await contender.query("BEGIN");
      await contender.query("SET LOCAL lock_timeout = '100ms'");
      await contender.query("SELECT set_config('hermes.user_id', $1, true)", [fixtures.ownerId]);
      await expectSqlState(
        () => contender.query("SELECT public.hermes_lock_approval_resolution($1)", [lockAgentId]),
        "55P03",
      );
      await contender.query("ROLLBACK");
      await first.query("COMMIT");

      await contender.query("BEGIN");
      await contender.query("SELECT set_config('hermes.user_id', $1, true)", [fixtures.adminId]);
      const afterCommit = await contender.query<{ version: number }>(
        "SELECT public.hermes_next_policy_version($1, $2) AS version",
        [lockAgentId, fixtures.organizationId],
      );
      expect(afterCommit.rows).toEqual([{ version: 2 }]);
      await contender.query("ROLLBACK");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await contender.query("ROLLBACK").catch(() => undefined);
      await first.query("RESET ROLE").catch(() => undefined);
      await contender.query("RESET ROLE").catch(() => undefined);
      first.release();
      contender.release();
    }
  });

  it("keeps one canonical audit chain for new policy, key, gateway, and approval events", async () => {
    const actions = ["policy.created", "key.enrolled", "approval.created", "approval.resolved"];
    await Promise.all(
      actions.map((action) =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query(
            `INSERT INTO public.agent_audit_logs (
              organization_id, agent_id, actor_type, actor_id, action, summary
            ) VALUES ($1, $2, 'user', $3, $4, 'Phase 2 integration event')`,
            [fixtures.organizationId, fixtures.agentId, fixtures.adminId, action],
          ),
        ),
      ),
    );
    await withVerifiedAgent(
      pool,
      fixtures.agentId,
      fixtures.organizationId,
      fixtures.externalKeyId,
      (client) =>
        client.query(
          `INSERT INTO public.agent_audit_logs (
            organization_id, agent_id, actor_type, actor_id, action, summary, decision
          ) VALUES (
            $1::uuid, $2::uuid, 'agent', ($2::uuid)::text,
            'gateway.denied', 'Gateway decision', 'deny'
          )`,
          [fixtures.organizationId, fixtures.agentId],
        ),
    );

    const verification = await withAppUser(pool, fixtures.adminId, (client) =>
      client.query<{ checked: string; valid: boolean }>(
        "SELECT checked, valid FROM public.hermes_verify_audit_chain($1)",
        [fixtures.organizationId],
      ),
    );
    const rows = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.agent_audit_logs
       WHERE organization_id = $1 AND action = ANY($2::text[])`,
      [fixtures.organizationId, [...actions, "gateway.denied"]],
    );

    expect(rows.rows).toEqual([{ count: 5 }]);
    expect(verification.rows).toEqual([{ checked: "5", valid: true }]);
  });
});
