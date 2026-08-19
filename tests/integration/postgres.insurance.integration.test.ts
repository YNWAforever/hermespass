import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const required = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;

if (required) {
  describe("PostgreSQL insurance test configuration", () => {
    it("requires DATABASE_URL_TEST", () => expect(databaseUrl).toBeTruthy());
  });
}

const migrationNames = [
  "0000_low_human_robot.sql",
  "0001_phase1_security_hardening.sql",
  "0002_policy_gateway.sql",
  "0003_gateway_auth_boundary.sql",
  "0004_approval_operations.sql",
  "0005_approval_revalidation.sql",
  "0006_scoped_payments.sql",
  "0007_payment_authorization_hardening.sql",
  "0008_mandate_verified_agent_boundary.sql",
  "0009_card_provisioning_transition.sql",
  "0010_wallet_card_provisioning_attempt.sql",
  "0011_payment_authorization_boundary.sql",
  "0012_insurance_lifecycle.sql",
];

async function resetAndMigrate(pool: Pool): Promise<void> {
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
    await client.query("SET ROLE migration_owner");
    for (const name of migrationNames) {
      const migration = await readFile(join(process.cwd(), "drizzle", name), "utf8");
      await client.query("BEGIN");
      try {
        for (const statement of migration.split("--> statement-breakpoint")) {
          const statementSql = statement.trim();
          if (statementSql) await client.query(statementSql);
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

async function asApp<T>(
  pool: Pool,
  userId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await client.query("SELECT set_config('hermes.user_id', $1, true)", [userId]);
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

async function asWorker<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await client.query("SELECT public.hermes_set_insurance_worker_claim()");
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

dbTest("insurance lifecycle schema and runtime functions", () => {
  let pool: Pool;
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const ownerId = `insurance-owner-${crypto.randomUUID()}`;
  const viewerId = `insurance-viewer-${crypto.randomUUID()}`;
  const otherOwnerId = `insurance-other-owner-${crypto.randomUUID()}`;
  const agentId = crypto.randomUUID();
  const otherAgentId = crypto.randomUUID();
  const now = new Date();

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    await resetAndMigrate(pool);
    await pool.query(
      "INSERT INTO public.organizations (id, name, slug) VALUES ($1, 'Insurance Org', $2), ($3, 'Other Insurance Org', $4)",
      [
        organizationId,
        `insurance-${crypto.randomUUID()}`,
        otherOrganizationId,
        `other-insurance-${crypto.randomUUID()}`,
      ],
    );
    await pool.query(
      "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'viewer'), ($4, $5, 'owner')",
      [organizationId, ownerId, viewerId, otherOrganizationId, otherOwnerId],
    );
    const agentSql =
      "INSERT INTO public.agents (id, organization_id, slug, did, name, role, risk, scopes, spend_cap_cents, status, credential_id, credential_jws, issued_at, expires_at, created_by) VALUES ($1, $2, $3, $4, 'Insurance Agent', 'operator', $5, ARRAY['catalog.read']::text[], 100000, 'active', $6, 'test', $7, $8, $9)";
    await pool.query(agentSql, [
      agentId,
      organizationId,
      `insurance-${crypto.randomUUID()}`,
      `did:web:insurance:${crypto.randomUUID()}`,
      "medium",
      `credential-${crypto.randomUUID()}`,
      now,
      new Date(now.getTime() + 86400000),
      ownerId,
    ]);
    await pool.query(agentSql, [
      otherAgentId,
      otherOrganizationId,
      `other-insurance-${crypto.randomUUID()}`,
      `did:web:insurance:other:${crypto.randomUUID()}`,
      "low",
      `credential-${crypto.randomUUID()}`,
      now,
      new Date(now.getTime() + 86400000),
      otherOwnerId,
    ]);
  });

  afterAll(async () => pool?.end());

  it("forces RLS and preserves tenant-safe quote, bind, commission, and webhook transitions", async () => {
    const policies = await pool.query<{ relforcerowsecurity: boolean }>(
      "SELECT relforcerowsecurity FROM pg_class WHERE oid IN ('public.insurance_policies'::regclass, 'public.insurance_policy_events'::regclass, 'public.insurance_commission_ledger'::regclass)",
    );
    expect(policies.rows).toHaveLength(3);
    expect(policies.rows.every((row) => row.relforcerowsecurity)).toBe(true);

    const context = await asApp(pool, ownerId, async (client) =>
      client.query("SELECT * FROM public.hermes_insurance_agent_context($1)", [agentId]),
    );
    expect(context.rows[0]).toMatchObject({ agent_id: agentId, risk: "medium", status: "active" });

    const quote = await asApp(pool, ownerId, async (client) =>
      client.query("SELECT * FROM public.hermes_insurance_quote_insert($1::jsonb)", [
        JSON.stringify({
          organizationId,
          agentId,
          insurerQuoteId: "mockq_insurance_1",
          coverageCents: 200000000,
          premiumCents: 25000,
          quotedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
        }),
      ]),
    );
    expect(quote.rows[0]).toMatchObject({
      status: "quoted",
      insurer_quote_id: "mockq_insurance_1",
      premium_cents: "25000",
    });
    const policyId = quote.rows[0].id as string;

    const viewerList = await asApp(pool, viewerId, async (client) =>
      client.query("SELECT * FROM public.hermes_insurance_policy_list($1, NULL, 20)", [
        organizationId,
      ]),
    );
    expect(viewerList.rows).toHaveLength(1);
    await expect(
      asApp(pool, viewerId, async (client) =>
        client.query("SELECT * FROM public.hermes_insurance_quote_insert($1::jsonb)", [
          JSON.stringify({
            organizationId,
            agentId,
            insurerQuoteId: "mockq_denied",
            coverageCents: 1,
            premiumCents: 1,
            expiresAt: new Date(now.getTime() + 86400000).toISOString(),
          }),
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const attemptId = crypto.randomUUID();
    const reserved = await asApp(pool, ownerId, async (client) =>
      client.query("SELECT * FROM public.hermes_insurance_bind_reserve($1, $2, $3)", [
        policyId,
        attemptId,
        new Date(now.getTime() + 5 * 60000),
      ]),
    );
    expect(reserved.rows[0].status).toBe("binding");
    const bound = await asApp(pool, ownerId, async (client) =>
      client.query("SELECT * FROM public.hermes_insurance_bind_finalize($1, $2, $3, $4, $5)", [
        policyId,
        attemptId,
        "mockp_insurance_1",
        now,
        new Date(now.getTime() + 365 * 86400000),
      ]),
    );
    expect(bound.rows[0]).toMatchObject({
      status: "active",
      insurer_policy_id: "mockp_insurance_1",
    });
    const ledger = await pool.query(
      "SELECT premium_cents, commission_bps, commission_cents FROM public.insurance_commission_ledger WHERE policy_id = $1",
      [policyId],
    );
    expect(ledger.rows[0]).toEqual({
      premium_cents: "25000",
      commission_bps: 2000,
      commission_cents: "5000",
    });

    const eventPayload = {
      organizationId,
      insurer: "mock",
      insurerPolicyId: "mockp_insurance_1",
      providerEventId: "evt-lapse-1",
      eventKind: "lapsed",
      effectiveAt: now.toISOString(),
    };
    await expect(
      asWorker(pool, async (client) =>
        client.query("SELECT public.hermes_insurance_provider_event($1::jsonb)", [
          JSON.stringify(eventPayload),
        ]),
      ),
    ).resolves.toMatchObject({ rows: [{ hermes_insurance_provider_event: true }] });
    await expect(
      asWorker(pool, async (client) =>
        client.query("SELECT public.hermes_insurance_provider_event($1::jsonb)", [
          JSON.stringify(eventPayload),
        ]),
      ),
    ).resolves.toMatchObject({ rows: [{ hermes_insurance_provider_event: false }] });
    const final = await pool.query("SELECT status FROM public.insurance_policies WHERE id = $1", [
      policyId,
    ]);
    expect(final.rows[0].status).toBe("lapsed");
    const audit = await pool.query(
      "SELECT action FROM public.agent_audit_logs WHERE organization_id = $1 AND action LIKE 'insurance.%' ORDER BY chain_position",
      [organizationId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "insurance.quote",
        "insurance.bind_started",
        "insurance.bound",
        "insurance.lapsed",
      ]),
    );

    const otherList = await asApp(pool, otherOwnerId, async (client) =>
      client.query("SELECT * FROM public.hermes_insurance_policy_list($1, NULL, 20)", [
        organizationId,
      ]),
    );
    expect(otherList.rows).toHaveLength(0);
  });
});
