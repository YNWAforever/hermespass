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
  amountCents: number | string = 12000,
  currency: string | null = "HKD",
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
      'Safe checkout summary', 'Integration justification', $6, $7, '5411', now(),
      $5::public.gateway_decision, $5::public.gateway_decision,
      'INTEGRATION_DECISION', 'Integration decision', 1,
      now(), now(), CASE WHEN $5::text = 'allow' THEN now() ELSE NULL END,
      CASE WHEN $5::text = 'allow' THEN now() + interval '5 minutes' ELSE NULL END
    ) RETURNING id`,
    [organizationId, agentId, keyId, nonce, decision, amountCents, currency],
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
    const [tables, role, routines, ddlPrivilege, runtimeOwnedTables, roleMemberships] =
      await Promise.all([
        pool.query(
          `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
          [tenantTables],
        ),
        pool.query(
          `SELECT rolcanlogin, rolsuper, rolreplication, rolbypassrls,
                rolcreatedb, rolcreaterole, rolinherit
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
              "hermes_consume_agent_key_enrollment",
              "hermes_consume_telegram_link_token",
              "hermes_create_agent_key_enrollment",
              "hermes_create_telegram_link_token",
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
              "hermes_record_approval_delivery",
              "hermes_resolve_approval",
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
        pool.query(
          `SELECT count(*)::int AS count
         FROM pg_catalog.pg_auth_members membership
         JOIN pg_catalog.pg_roles member ON member.oid = membership.member
         WHERE member.rolname = 'hermes_app'`,
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
        rolreplication: false,
        rolsuper: false,
      },
    ]);
    expect(routines.rows).toHaveLength(21);
    expect(
      routines.rows.every(({ settings }) =>
        settings?.includes("search_path=pg_catalog, public, pg_temp"),
      ),
    ).toBe(true);
    expect(ddlPrivilege.rows).toEqual([{ can_create: false }]);
    expect(runtimeOwnedTables.rows).toEqual([]);
    expect(roleMemberships.rows).toEqual([{ count: 0 }]);
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

  it("rejects revoked keys, revoked agents, and expired passports at the verified-agent boundary", async () => {
    const revokedKeyAgentId = await insertAgent(
      pool,
      fixtures.organizationId,
      `revoked-key-agent-${suffix()}`,
    );
    const revokedKeyId = await insertExternalKey(
      pool,
      revokedKeyAgentId,
      fixtures.organizationId,
      `revoked-key-${suffix()}`,
    );
    await pool.query(
      `UPDATE public.agent_keys
       SET status = 'revoked', revoked_at = clock_timestamp()
       WHERE id = $1`,
      [revokedKeyId],
    );

    const revokedAgentId = await insertAgent(
      pool,
      fixtures.organizationId,
      `revoked-agent-${suffix()}`,
    );
    const revokedAgentKeyId = await insertExternalKey(
      pool,
      revokedAgentId,
      fixtures.organizationId,
      `revoked-agent-key-${suffix()}`,
    );
    await pool.query(
      `UPDATE public.agents
       SET status = 'revoked', revoked_at = clock_timestamp(), revoked_by = $2
       WHERE id = $1`,
      [revokedAgentId, fixtures.ownerId],
    );

    const expiredAgentId = await insertAgent(
      pool,
      fixtures.organizationId,
      `expired-agent-${suffix()}`,
    );
    const expiredAgentKeyId = await insertExternalKey(
      pool,
      expiredAgentId,
      fixtures.organizationId,
      `expired-agent-key-${suffix()}`,
    );
    await pool.query(
      "UPDATE public.agents SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
      [expiredAgentId],
    );

    for (const [agentId, keyId] of [
      [revokedKeyAgentId, revokedKeyId],
      [revokedAgentId, revokedAgentKeyId],
      [expiredAgentId, expiredAgentKeyId],
    ]) {
      await expectSqlState(
        () =>
          withVerifiedAgent(pool, agentId!, fixtures.organizationId, keyId!, async () => undefined),
        "P0002",
      );
    }
  });

  it("keeps every cents value within the JavaScript safe-integer range and allows spend only in HKD", async () => {
    const unsafeCents = "9007199254740992";
    const policyCount = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.agent_policies WHERE agent_id = $1 AND version = 1",
      [fixtures.agentId],
    );
    if (policyCount.rows[0]!.count === 0) {
      await insertPolicy(
        pool,
        fixtures.organizationId,
        fixtures.agentId,
        fixtures.assignedReviewerId,
      );
    }

    await expectSqlState(
      () =>
        pool.query("UPDATE public.agents SET spend_cap_cents = $2 WHERE id = $1", [
          fixtures.agentId,
          unsafeCents,
        ]),
      "23514",
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
              $1, $2, 999, 'HKD', 1, 2, $3, 1,
              ARRAY[]::text[], false, $4, false, clock_timestamp(), $5
            )`,
            [
              fixtures.organizationId,
              fixtures.agentId,
              unsafeCents,
              fixtures.assignedReviewerId,
              fixtures.adminId,
            ],
          ),
        ),
      "23514",
    );

    await expectSqlState(
      () =>
        insertGatewayRequest(
          pool,
          fixtures.organizationId,
          fixtures.agentId,
          fixtures.externalKeyId,
          `unsafe-cents-${suffix()}`,
          "deny",
          unsafeCents,
        ),
      "23514",
    );

    await expectSqlState(
      () =>
        insertGatewayRequest(
          pool,
          fixtures.organizationId,
          fixtures.agentId,
          fixtures.externalKeyId,
          `allow-usd-${suffix()}`,
          "allow",
          12000,
          "USD",
        ),
      "23514",
    );
    await expectSqlState(
      () =>
        insertGatewayRequest(
          pool,
          fixtures.organizationId,
          fixtures.agentId,
          fixtures.externalKeyId,
          `allow-null-currency-${suffix()}`,
          "allow",
          12000,
          null,
        ),
      "23514",
    );
    await expect(
      insertGatewayRequest(
        pool,
        fixtures.organizationId,
        fixtures.agentId,
        fixtures.externalKeyId,
        `deny-usd-${suffix()}`,
        "deny",
        12000,
        "USD",
      ),
    ).resolves.toEqual(expect.any(String));

    await expectSqlState(
      () =>
        pool.query(
          `INSERT INTO public.agent_audit_logs (
            organization_id, agent_id, actor_type, actor_id, action, summary, amount_cents
          ) VALUES ($1, $2, 'user', $3, 'gateway.unsafe-cents', 'Unsafe cents', $4)`,
          [fixtures.organizationId, fixtures.agentId, fixtures.ownerId, unsafeCents],
        ),
      "23514",
    );
  });

  it("creates and atomically consumes agent-key enrollments through the runtime boundary", async () => {
    const enrollmentAgentId = await insertAgent(
      pool,
      fixtures.organizationId,
      `enrollment-agent-${suffix()}`,
    );
    const previousKeyId = await insertExternalKey(
      pool,
      enrollmentAgentId,
      fixtures.organizationId,
      `enrollment-old-key-${suffix()}`,
    );
    const enrollmentHash = Buffer.alloc(32, 17);
    const created = await withAppUser(pool, fixtures.adminId, (client) =>
      client.query<{ enrollment_id: string; expires_at: Date }>(
        "SELECT * FROM public.hermes_create_agent_key_enrollment($1, $2, $3)",
        [fixtures.organizationId, enrollmentAgentId, enrollmentHash],
      ),
    );
    expect(created.rows).toHaveLength(1);
    expect(created.rows[0]!.expires_at.getTime()).toBeGreaterThan(Date.now());
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query("SELECT * FROM public.hermes_create_agent_key_enrollment($1, $2, $3)", [
            fixtures.organizationId,
            enrollmentAgentId,
            enrollmentHash,
          ]),
        ),
      "23505",
    );

    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.viewerId, (client) =>
          client.query("SELECT * FROM public.hermes_create_agent_key_enrollment($1, $2, $3)", [
            fixtures.organizationId,
            enrollmentAgentId,
            Buffer.alloc(32, 18),
          ]),
        ),
      "42501",
    );

    const newKeyFragment = `enrollment-new-key-${suffix()}`;
    const consumed = await withAppTransaction(
      pool,
      async () => undefined,
      (client) =>
        client.query<{ agent_id: string; organization_id: string; key_id: string }>(
          `SELECT * FROM public.hermes_consume_agent_key_enrollment(
            $1, $2, $3::jsonb, $4
          )`,
          [
            enrollmentHash,
            newKeyFragment,
            JSON.stringify({ kty: "OKP", crv: "Ed25519", x: newKeyFragment }),
            `thumbprint-${newKeyFragment}`,
          ],
        ),
    );
    expect(consumed.rows).toEqual([
      {
        agent_id: enrollmentAgentId,
        organization_id: fixtures.organizationId,
        key_id: expect.any(String),
      },
    ]);

    const enrollmentState = await pool.query(
      `SELECT enrollment.consumed_key_id, enrollment.consumed_at IS NOT NULL AS consumed,
              previous.status::text AS previous_status,
              activated.status::text AS activated_status,
              activated.custody::text AS custody,
              activated.ciphertext IS NULL AND activated.iv IS NULL
                AND activated.wrapped_dek IS NULL AND activated.kek_version IS NULL
                AND activated.encryption_algorithm IS NULL AS private_material_absent
       FROM public.agent_key_enrollments enrollment
       JOIN public.agent_keys previous ON previous.id = $2
       JOIN public.agent_keys activated ON activated.id = enrollment.consumed_key_id
       WHERE enrollment.id = $1`,
      [created.rows[0]!.enrollment_id, previousKeyId],
    );
    expect(enrollmentState.rows).toEqual([
      {
        activated_status: "active",
        consumed: true,
        consumed_key_id: consumed.rows[0]!.key_id,
        custody: "external",
        previous_status: "revoked",
        private_material_absent: true,
      },
    ]);

    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            client.query(
              "SELECT * FROM public.hermes_consume_agent_key_enrollment($1, 'replay', '{}'::jsonb, 'replay')",
              [enrollmentHash],
            ),
        ),
      "P0002",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query("SELECT token_hash FROM public.agent_key_enrollments"),
        ),
      "42501",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.adminId, (client) =>
          client.query(
            "UPDATE public.agent_key_enrollments SET consumed_at = clock_timestamp() WHERE id = $1",
            [created.rows[0]!.enrollment_id],
          ),
        ),
      "42501",
    );

    const expiredHash = Buffer.alloc(32, 19);
    await pool.query(
      `INSERT INTO public.agent_key_enrollments (
        organization_id, agent_id, token_hash, expires_at, created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, clock_timestamp() - interval '1 minute', $4,
        clock_timestamp() - interval '16 minutes'
      )`,
      [fixtures.organizationId, enrollmentAgentId, expiredHash, fixtures.adminId],
    );
    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            client.query(
              "SELECT * FROM public.hermes_consume_agent_key_enrollment($1, 'expired', '{}'::jsonb, 'expired')",
              [expiredHash],
            ),
        ),
      "P0002",
    );

    const lockExpiryHash = Buffer.alloc(32, 20);
    const lockExpiryToken = await pool.query<{ id: string }>(
      `INSERT INTO public.agent_key_enrollments (
        organization_id, agent_id, token_hash, expires_at, created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, clock_timestamp() + interval '200 milliseconds', $4,
        clock_timestamp() - interval '14 minutes'
      ) RETURNING id`,
      [fixtures.organizationId, enrollmentAgentId, lockExpiryHash, fixtures.adminId],
    );
    const tokenLocker = await pool.connect();
    try {
      await tokenLocker.query("BEGIN");
      await tokenLocker.query(
        "SELECT id FROM public.agent_key_enrollments WHERE id = $1 FOR UPDATE",
        [lockExpiryToken.rows[0]!.id],
      );
      const blockedConsumption = withAppTransaction(
        pool,
        async () => undefined,
        (client) =>
          client.query(
            `SELECT * FROM public.hermes_consume_agent_key_enrollment(
            $1, 'lock-expired', '{"kty":"OKP"}'::jsonb, 'lock-expired'
          )`,
            [lockExpiryHash],
          ),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tokenLocker.query("COMMIT");
      await expect(blockedConsumption).rejects.toMatchObject({ code: "P0002" });
    } finally {
      await tokenLocker.query("ROLLBACK").catch(() => undefined);
      tokenLocker.release();
    }

    const advisoryExpiryHash = Buffer.alloc(32, 21);
    await pool.query(
      `INSERT INTO public.agent_key_enrollments (
        organization_id, agent_id, token_hash, expires_at, created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, clock_timestamp() + interval '200 milliseconds', $4,
        clock_timestamp() - interval '14 minutes'
      )`,
      [fixtures.organizationId, enrollmentAgentId, advisoryExpiryHash, fixtures.adminId],
    );
    const agentLocker = await pool.connect();
    try {
      await agentLocker.query("BEGIN");
      await agentLocker.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended('hermes.agent:' || $1::text, 0)
        )`,
        [enrollmentAgentId],
      );
      const advisoryBlockedConsumption = withAppTransaction(
        pool,
        async () => undefined,
        (client) =>
          client.query(
            `SELECT * FROM public.hermes_consume_agent_key_enrollment(
              $1, 'advisory-expired', '{"kty":"OKP"}'::jsonb, 'advisory-expired'
            )`,
            [advisoryExpiryHash],
          ),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await agentLocker.query("COMMIT");
      await expect(advisoryBlockedConsumption).rejects.toMatchObject({ code: "P0002" });
    } finally {
      await agentLocker.query("ROLLBACK").catch(() => undefined);
      agentLocker.release();
    }

    const invalidatedAgentId = await insertAgent(
      pool,
      fixtures.organizationId,
      `invalidated-enrollment-agent-${suffix()}`,
    );
    await insertExternalKey(
      pool,
      invalidatedAgentId,
      fixtures.organizationId,
      `invalidated-enrollment-key-${suffix()}`,
    );
    const invalidatedEnrollmentHash = Buffer.alloc(32, 22);
    await withAppUser(pool, fixtures.adminId, (client) =>
      client.query("SELECT * FROM public.hermes_create_agent_key_enrollment($1, $2, $3)", [
        fixtures.organizationId,
        invalidatedAgentId,
        invalidatedEnrollmentHash,
      ]),
    );
    await pool.query(
      `UPDATE public.agents
       SET status = 'revoked', revoked_at = clock_timestamp(), revoked_by = $2
       WHERE id = $1`,
      [invalidatedAgentId, fixtures.ownerId],
    );
    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            client.query(
              `SELECT * FROM public.hermes_consume_agent_key_enrollment(
                $1, 'invalidated-agent', '{"kty":"OKP"}'::jsonb, 'invalidated-agent'
              )`,
              [invalidatedEnrollmentHash],
            ),
        ),
      "P0002",
    );
  });

  it("creates and atomically consumes Telegram link tokens through the runtime boundary", async () => {
    const historicalLink = await pool.query<{ id: string }>(
      `INSERT INTO public.telegram_links (
        organization_id, user_id, telegram_user_id, telegram_chat_id
      ) VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        fixtures.organizationId,
        fixtures.unassignedAdminId,
        Number(`7${Date.now().toString().slice(-9)}`),
        Number(`6${Date.now().toString().slice(-9)}`),
      ],
    );
    const tokenHash = Buffer.alloc(32, 27);
    const created = await withAppUser(pool, fixtures.ownerId, (client) =>
      client.query<{ expires_at: Date; link_token_id: string }>(
        "SELECT * FROM public.hermes_create_telegram_link_token($1, $2, $3)",
        [fixtures.organizationId, fixtures.unassignedAdminId, tokenHash],
      ),
    );
    expect(created.rows).toHaveLength(1);
    expect(created.rows[0]!.expires_at.getTime()).toBeGreaterThan(Date.now());
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.ownerId, (client) =>
          client.query("SELECT * FROM public.hermes_create_telegram_link_token($1, $2, $3)", [
            fixtures.organizationId,
            fixtures.unassignedAdminId,
            tokenHash,
          ]),
        ),
      "23505",
    );

    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.viewerId, (client) =>
          client.query("SELECT * FROM public.hermes_create_telegram_link_token($1, $2, $3)", [
            fixtures.organizationId,
            fixtures.viewerId,
            Buffer.alloc(32, 28),
          ]),
        ),
      "42501",
    );

    const telegramUserId = Number(`8${Date.now().toString().slice(-9)}`);
    const telegramChatId = Number(`9${Date.now().toString().slice(-9)}`);
    const consumed = await withAppTransaction(
      pool,
      async () => undefined,
      (client) =>
        client.query<{ link_id: string; organization_id: string; user_id: string }>(
          "SELECT * FROM public.hermes_consume_telegram_link_token($1, $2, $3)",
          [tokenHash, telegramUserId, telegramChatId],
        ),
    );
    expect(consumed.rows).toEqual([
      {
        link_id: expect.any(String),
        organization_id: fixtures.organizationId,
        user_id: fixtures.unassignedAdminId,
      },
    ]);
    expect(consumed.rows[0]!.link_id).not.toBe(historicalLink.rows[0]!.id);

    const linkState = await pool.query(
      `SELECT token.consumed_link_id, token.consumed_at IS NOT NULL AS consumed,
              historical.is_active AS historical_active,
              linked.is_active AS linked_active,
              linked.telegram_user_id::text AS telegram_user_id,
              linked.telegram_chat_id::text AS telegram_chat_id
       FROM public.telegram_link_tokens token
       JOIN public.telegram_links historical ON historical.id = $2
       JOIN public.telegram_links linked ON linked.id = token.consumed_link_id
       WHERE token.id = $1`,
      [created.rows[0]!.link_token_id, historicalLink.rows[0]!.id],
    );
    expect(linkState.rows).toEqual([
      {
        consumed: true,
        consumed_link_id: consumed.rows[0]!.link_id,
        historical_active: false,
        linked_active: true,
        telegram_chat_id: String(telegramChatId),
        telegram_user_id: String(telegramUserId),
      },
    ]);

    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            client.query("SELECT * FROM public.hermes_consume_telegram_link_token($1, $2, $3)", [
              tokenHash,
              telegramUserId + 1,
              telegramChatId + 1,
            ]),
        ),
      "P0002",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.ownerId, (client) =>
          client.query("SELECT token_hash FROM public.telegram_link_tokens"),
        ),
      "42501",
    );

    const expiredHash = Buffer.alloc(32, 29);
    await pool.query(
      `INSERT INTO public.telegram_link_tokens (
        organization_id, user_id, token_hash, expires_at, created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, clock_timestamp() - interval '1 minute', $4,
        clock_timestamp() - interval '11 minutes'
      )`,
      [fixtures.organizationId, fixtures.unassignedAdminId, expiredHash, fixtures.ownerId],
    );
    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            client.query("SELECT * FROM public.hermes_consume_telegram_link_token($1, $2, $3)", [
              expiredHash,
              telegramUserId + 2,
              telegramChatId + 2,
            ]),
        ),
      "P0002",
    );

    const lockExpiryHash = Buffer.alloc(32, 30);
    const lockExpiryToken = await pool.query<{ id: string }>(
      `INSERT INTO public.telegram_link_tokens (
        organization_id, user_id, token_hash, expires_at, created_by_user_id, created_at
      ) VALUES (
        $1, $2, $3, clock_timestamp() + interval '200 milliseconds', $4,
        clock_timestamp() - interval '9 minutes'
      ) RETURNING id`,
      [fixtures.organizationId, fixtures.unassignedAdminId, lockExpiryHash, fixtures.ownerId],
    );
    const tokenLocker = await pool.connect();
    try {
      await tokenLocker.query("BEGIN");
      await tokenLocker.query(
        "SELECT id FROM public.telegram_link_tokens WHERE id = $1 FOR UPDATE",
        [lockExpiryToken.rows[0]!.id],
      );
      const blockedConsumption = withAppTransaction(
        pool,
        async () => undefined,
        (client) =>
          client.query("SELECT * FROM public.hermes_consume_telegram_link_token($1, $2, $3)", [
            lockExpiryHash,
            telegramUserId + 3,
            telegramChatId + 3,
          ]),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tokenLocker.query("COMMIT");
      await expect(blockedConsumption).rejects.toMatchObject({ code: "P0002" });
    } finally {
      await tokenLocker.query("ROLLBACK").catch(() => undefined);
      tokenLocker.release();
    }

    const demotedHash = Buffer.alloc(32, 31);
    await withAppUser(pool, fixtures.ownerId, (client) =>
      client.query("SELECT * FROM public.hermes_create_telegram_link_token($1, $2, $3)", [
        fixtures.organizationId,
        fixtures.unassignedAdminId,
        demotedHash,
      ]),
    );
    await pool.query(
      "UPDATE public.org_members SET role = 'viewer' WHERE organization_id = $1 AND user_id = $2",
      [fixtures.organizationId, fixtures.unassignedAdminId],
    );
    try {
      await expectSqlState(
        () =>
          withAppTransaction(
            pool,
            async () => undefined,
            (client) =>
              client.query("SELECT * FROM public.hermes_consume_telegram_link_token($1, $2, $3)", [
                demotedHash,
                telegramUserId + 4,
                telegramChatId + 4,
              ]),
          ),
        "P0002",
      );
    } finally {
      await pool.query(
        "UPDATE public.org_members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2",
        [fixtures.organizationId, fixtures.unassignedAdminId],
      );
    }
  });

  it("stores token digests only and exposes no token-table privileges to the runtime role", async () => {
    const unsafeColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('agent_key_enrollments', 'telegram_link_tokens')
         AND column_name ~* '(plain|raw)_?token'`,
    );
    expect(unsafeColumns.rows).toEqual([]);

    const privileges = await pool.query<{
      enrollment_insert: boolean;
      enrollment_select: boolean;
      enrollment_update: boolean;
      link_token_insert: boolean;
      link_token_select: boolean;
      link_token_update: boolean;
    }>(
      `SELECT
        has_table_privilege('hermes_app', 'public.agent_key_enrollments', 'INSERT') AS enrollment_insert,
        has_table_privilege('hermes_app', 'public.agent_key_enrollments', 'SELECT') AS enrollment_select,
        has_table_privilege('hermes_app', 'public.agent_key_enrollments', 'UPDATE') AS enrollment_update,
        has_table_privilege('hermes_app', 'public.telegram_link_tokens', 'INSERT') AS link_token_insert,
        has_table_privilege('hermes_app', 'public.telegram_link_tokens', 'SELECT') AS link_token_select,
        has_table_privilege('hermes_app', 'public.telegram_link_tokens', 'UPDATE') AS link_token_update`,
    );
    expect(privileges.rows).toEqual([
      {
        enrollment_insert: false,
        enrollment_select: false,
        enrollment_update: false,
        link_token_insert: false,
        link_token_select: false,
        link_token_update: false,
      },
    ]);
  });

  it("resolves an approval and its gateway result atomically through the authenticated runtime boundary", async () => {
    const policyCount = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.agent_policies WHERE agent_id = $1 AND version = 1",
      [fixtures.agentId],
    );
    if (policyCount.rows[0]!.count === 0) {
      await insertPolicy(
        pool,
        fixtures.organizationId,
        fixtures.agentId,
        fixtures.assignedReviewerId,
      );
    }

    const requestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `atomic-approval-${suffix()}`,
    );
    const approvalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      requestId,
      fixtures.assignedReviewerId,
    );

    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.unassignedAdminId, (client) =>
          client.query(
            "SELECT * FROM public.hermes_resolve_approval($1, 'allow', 'web', 'Spoofed approval')",
            [approvalId],
          ),
        ),
      "42501",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.assignedReviewerId, (client) =>
          client.query(
            `UPDATE public.pending_approvals
             SET status = 'approved', resolution = 'allow', resolution_source = 'web',
               resolved_by_user_id = $2, resolved_at = clock_timestamp()
             WHERE id = $1`,
            [approvalId, fixtures.unassignedAdminId],
          ),
        ),
      "42501",
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.assignedReviewerId, (client) =>
          client.query(
            "SELECT * FROM public.hermes_resolve_approval($1, 'deny', 'owner_override', 'Not an owner')",
            [approvalId],
          ),
        ),
      "42501",
    );

    const expiredRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `expired-approval-${suffix()}`,
    );
    const expiredApproval = await pool.query<{ id: string }>(
      `INSERT INTO public.pending_approvals (
        organization_id, agent_id, gateway_request_id, assigned_reviewer_user_id,
        status, expires_at, telegram_delivery_state, created_at
      ) VALUES (
        $1, $2, $3, $4, 'pending', clock_timestamp() - interval '1 second',
        'not_requested', clock_timestamp() - interval '3 hours'
      ) RETURNING id`,
      [fixtures.organizationId, fixtures.agentId, expiredRequestId, fixtures.assignedReviewerId],
    );
    await expectSqlState(
      () =>
        withAppUser(pool, fixtures.assignedReviewerId, (client) =>
          client.query(
            "SELECT * FROM public.hermes_resolve_approval($1, 'allow', 'web', 'Too late')",
            [expiredApproval.rows[0]!.id],
          ),
        ),
      "P0001",
    );

    const demotedRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `atomic-demoted-${suffix()}`,
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
      await expectSqlState(
        () =>
          withAppUser(pool, fixtures.assignedReviewerId, (client) =>
            client.query(
              "SELECT * FROM public.hermes_resolve_approval($1, 'allow', 'web', 'Demoted')",
              [demotedApprovalId],
            ),
          ),
        "42501",
      );
    } finally {
      await pool.query(
        "UPDATE public.org_members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2",
        [fixtures.organizationId, fixtures.assignedReviewerId],
      );
    }

    const resolved = await withAppUser(pool, fixtures.assignedReviewerId, (client) =>
      client.query(
        "SELECT * FROM public.hermes_resolve_approval($1, 'allow', 'web', 'Assigned reviewer approved')",
        [approvalId],
      ),
    );
    expect(resolved.rows).toEqual([
      {
        approval_id: approvalId,
        approval_status: "approved",
        current_decision: "allow",
        gateway_request_id: requestId,
      },
    ]);
    const resolvedState = await pool.query(
      `SELECT approval.resolved_by_user_id, approval.status::text,
              request.current_decision::text, request.authorized_at IS NOT NULL AS authorized
       FROM public.pending_approvals approval
       JOIN public.gateway_requests request ON request.id = approval.gateway_request_id
       WHERE approval.id = $1`,
      [approvalId],
    );
    expect(resolvedState.rows).toEqual([
      {
        authorized: true,
        current_decision: "allow",
        resolved_by_user_id: fixtures.assignedReviewerId,
        status: "approved",
      },
    ]);

    const rollbackRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `rollback-approval-${suffix()}`,
    );
    const rollbackApprovalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      rollbackRequestId,
      fixtures.assignedReviewerId,
    );
    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("SET ROLE hermes_app");
      await rollbackClient.query("BEGIN");
      await rollbackClient.query("SELECT set_config('hermes.user_id', $1, true)", [
        fixtures.assignedReviewerId,
      ]);
      await rollbackClient.query(
        "SELECT * FROM public.hermes_resolve_approval($1, 'deny', 'web', 'Rollback proof')",
        [rollbackApprovalId],
      );
      await rollbackClient.query("ROLLBACK");
    } finally {
      await rollbackClient.query("ROLLBACK").catch(() => undefined);
      await rollbackClient.query("RESET ROLE").catch(() => undefined);
      rollbackClient.release();
    }
    const rollbackState = await pool.query(
      `SELECT approval.status::text, request.current_decision::text
       FROM public.pending_approvals approval
       JOIN public.gateway_requests request ON request.id = approval.gateway_request_id
       WHERE approval.id = $1`,
      [rollbackApprovalId],
    );
    expect(rollbackState.rows).toEqual([{ current_decision: "hold", status: "pending" }]);

    const expiryResolved = await withAppTransaction(
      pool,
      async () => undefined,
      (client) =>
        client.query(
          "SELECT * FROM public.hermes_resolve_approval($1, 'deny', 'expiry', 'Approval expired')",
          [expiredApproval.rows[0]!.id],
        ),
    );
    expect(expiryResolved.rows[0]).toMatchObject({
      approval_status: "expired",
      current_decision: "deny",
    });

    const raceRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `race-approval-${suffix()}`,
    );
    const raceApprovalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      raceRequestId,
      fixtures.assignedReviewerId,
    );
    const winner = await pool.connect();
    const contender = await pool.connect();
    try {
      await winner.query("SET ROLE hermes_app");
      await winner.query("BEGIN");
      await winner.query("SELECT set_config('hermes.user_id', $1, true)", [fixtures.ownerId]);
      await winner.query(
        "SELECT * FROM public.hermes_resolve_approval($1, 'deny', 'owner_override', 'Owner won')",
        [raceApprovalId],
      );

      await contender.query("SET ROLE hermes_app");
      await contender.query("BEGIN");
      await contender.query("SELECT set_config('hermes.user_id', $1, true)", [
        fixtures.assignedReviewerId,
      ]);
      const contenderPid = await contender.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const losingResolution = contender.query(
        "SELECT * FROM public.hermes_resolve_approval($1, 'allow', 'web', 'Reviewer lost')",
        [raceApprovalId],
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const blocked = await pool.query<{ waiting: boolean }>(
        `SELECT wait_event_type = 'Lock' AND wait_event = 'advisory' AS waiting
         FROM pg_stat_activity WHERE pid = $1`,
        [contenderPid.rows[0]!.pid],
      );
      expect(blocked.rows).toEqual([{ waiting: true }]);

      await winner.query("COMMIT");
      await expect(losingResolution).rejects.toMatchObject({ code: "P0001" });
      await contender.query("ROLLBACK");
    } finally {
      await winner.query("ROLLBACK").catch(() => undefined);
      await contender.query("ROLLBACK").catch(() => undefined);
      await winner.query("RESET ROLE").catch(() => undefined);
      await contender.query("RESET ROLE").catch(() => undefined);
      winner.release();
      contender.release();
    }
    const raceState = await pool.query(
      `SELECT approval.status::text, approval.resolution_source::text,
              approval.resolved_by_user_id, request.current_decision::text
       FROM public.pending_approvals approval
       JOIN public.gateway_requests request ON request.id = approval.gateway_request_id
       WHERE approval.id = $1`,
      [raceApprovalId],
    );
    expect(raceState.rows).toEqual([
      {
        current_decision: "deny",
        resolution_source: "owner_override",
        resolved_by_user_id: fixtures.ownerId,
        status: "denied",
      },
    ]);
  });

  it("records Telegram delivery attempts monotonically without terminal-state regression", async () => {
    const policyCount = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.agent_policies WHERE agent_id = $1 AND version = 1",
      [fixtures.agentId],
    );
    if (policyCount.rows[0]!.count === 0) {
      await insertPolicy(
        pool,
        fixtures.organizationId,
        fixtures.agentId,
        fixtures.assignedReviewerId,
      );
    }
    const requestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `delivery-${suffix()}`,
    );
    const approvalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      requestId,
      fixtures.assignedReviewerId,
    );

    for (const [state, errorCode] of [
      ["pending", null],
      ["failed", "TELEGRAM_TIMEOUT"],
      ["pending", null],
      ["sent", null],
    ] as const) {
      await withAppTransaction(
        pool,
        async () => undefined,
        (client) =>
          client.query("SELECT * FROM public.hermes_record_approval_delivery($1, $2, $3)", [
            approvalId,
            state,
            errorCode,
          ]),
      );
    }
    const delivered = await pool.query(
      `SELECT telegram_delivery_state::text, telegram_delivery_attempts,
              telegram_delivered_at IS NOT NULL AS delivered
       FROM public.pending_approvals WHERE id = $1`,
      [approvalId],
    );
    expect(delivered.rows).toEqual([
      { delivered: true, telegram_delivery_attempts: 2, telegram_delivery_state: "sent" },
    ]);

    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            client.query("SELECT * FROM public.hermes_record_approval_delivery($1, 'failed', $2)", [
              approvalId,
              "LATE_FAILURE",
            ]),
        ),
      "P0001",
    );
    await expectSqlState(
      () =>
        pool.query(
          `UPDATE public.pending_approvals
           SET telegram_delivery_attempts = telegram_delivery_attempts - 1
           WHERE id = $1`,
          [approvalId],
        ),
      "P0001",
    );

    const resolvedRequestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `resolved-delivery-${suffix()}`,
    );
    const resolvedApprovalId = await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      resolvedRequestId,
      fixtures.assignedReviewerId,
    );
    await withAppUser(pool, fixtures.assignedReviewerId, (client) =>
      client.query("SELECT * FROM public.hermes_resolve_approval($1, 'deny', 'web', 'Resolved')", [
        resolvedApprovalId,
      ]),
    );
    await expectSqlState(
      () =>
        withAppTransaction(
          pool,
          async () => undefined,
          (client) =>
            client.query(
              "SELECT * FROM public.hermes_record_approval_delivery($1, 'pending', NULL) ",
              [resolvedApprovalId],
            ),
        ),
      "P0001",
    );
  });

  it("enforces duplicate-nonce, one-to-one approval, and composite tenant integrity", async () => {
    const policyCount = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.agent_policies WHERE agent_id = $1 AND version = 1",
      [fixtures.agentId],
    );
    if (policyCount.rows[0]!.count === 0) {
      await insertPolicy(
        pool,
        fixtures.organizationId,
        fixtures.agentId,
        fixtures.assignedReviewerId,
      );
    }

    const duplicateNonce = `duplicate-${suffix()}`;
    await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      duplicateNonce,
      "deny",
    );
    await expectSqlState(
      () =>
        insertGatewayRequest(
          pool,
          fixtures.organizationId,
          fixtures.agentId,
          fixtures.externalKeyId,
          duplicateNonce,
          "deny",
        ),
      "23505",
    );

    const requestId = await insertGatewayRequest(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      fixtures.externalKeyId,
      `one-to-one-${suffix()}`,
    );
    await insertApproval(
      pool,
      fixtures.organizationId,
      fixtures.agentId,
      requestId,
      fixtures.assignedReviewerId,
    );
    await expectSqlState(
      () =>
        insertApproval(
          pool,
          fixtures.organizationId,
          fixtures.agentId,
          requestId,
          fixtures.assignedReviewerId,
        ),
      "23505",
    );

    await expectSqlState(
      () =>
        insertGatewayRequest(
          pool,
          fixtures.organizationId,
          fixtures.otherAgentId,
          fixtures.otherExternalKeyId,
          `cross-agent-tenant-${suffix()}`,
          "deny",
        ),
      "23503",
    );
    await expectSqlState(
      () =>
        insertGatewayRequest(
          pool,
          fixtures.organizationId,
          fixtures.agentId,
          fixtures.otherExternalKeyId,
          `cross-key-tenant-${suffix()}`,
          "deny",
        ),
      "23503",
    );
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
