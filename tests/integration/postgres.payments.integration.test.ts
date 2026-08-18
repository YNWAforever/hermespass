import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import type { Transaction } from "@/lib/db";
import { readPaymentSpendTotals, recordPaymentAuthorization } from "@/lib/payments/postgres-store";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const required = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;

if (required) {
  describe("PostgreSQL payment test configuration", () => {
    it("requires DATABASE_URL_TEST", () => {
      expect(databaseUrl).toBeTruthy();
    });
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

async function appTransaction<T>(
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

dbTest("payment schema and store", () => {
  let pool: Pool;
  let fixture: {
    organizationId: string;
    otherOrganizationId: string;
    ownerId: string;
    viewerId: string;
    agentId: string;
    cardId: string;
    policyVersion: number;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 6 });
    await resetAndMigrate(pool);

    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const ownerId = "payment-owner-" + crypto.randomUUID();
    const viewerId = "payment-viewer-" + crypto.randomUUID();
    const agentId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const keyId = crypto.randomUUID();

    await pool.query(
      "INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)",
      [
        organizationId,
        "Payment Test Org",
        "payment-test-" + crypto.randomUUID(),
        otherOrganizationId,
        "Other Payment Org",
        "other-payment-" + crypto.randomUUID(),
      ],
    );
    await pool.query(
      "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'viewer')",
      [organizationId, ownerId, viewerId],
    );
    await pool.query(
      "INSERT INTO public.agents (id, organization_id, slug, did, name, role, risk, scopes, spend_cap_cents, status, credential_id, credential_jws, issued_at, expires_at, created_by) VALUES ($1, $2, $3, $4, 'Payment Test Agent', 'operator', 'low', ARRAY['catalog.read']::text[], 100000, 'active', $5, 'test', now(), now() + interval '1 day', $6)",
      [
        agentId,
        organizationId,
        "payment-agent-" + crypto.randomUUID(),
        "did:web:payment.test:" + crypto.randomUUID(),
        "credential-" + crypto.randomUUID(),
        ownerId,
      ],
    );
    await pool.query(
      "INSERT INTO public.agent_keys (id, agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status) VALUES ($1, $2, $3, 'external-1', $4::jsonb, 'payment-thumbprint', 'external', 'active')",
      [
        keyId,
        agentId,
        organizationId,
        JSON.stringify({
          kty: "OKP",
          crv: "Ed25519",
          x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        }),
      ],
    );
    await pool.query(
      "INSERT INTO public.agent_policies (organization_id, agent_id, version, currency, per_transaction_limit_cents, daily_limit_cents, monthly_limit_cents, approval_threshold_cents, mcc_allowlist, mcc_required, assigned_reviewer_user_id, created_by_user_id) VALUES ($1, $2, 1, 'HKD', 50000, 100000, 100000, 50000, ARRAY[]::text[], false, $3, $3)",
      [organizationId, agentId, ownerId],
    );
    await pool.query(
      "INSERT INTO public.wallet_cards (id, organization_id, agent_id, rail, rail_cardholder_id, rail_card_id, last4, brand, currency, status, policy_version) VALUES ($1, $2, $3, 'mock', 'holder-1', 'card-1', '4242', 'Visa', 'HKD', 'active', 1)",
      [cardId, organizationId, agentId],
    );
    fixture = {
      organizationId,
      otherOrganizationId,
      ownerId,
      viewerId,
      agentId,
      cardId,
      policyVersion: 1,
    };
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  function runner() {
    const database = drizzle(pool, { schema });
    return async <T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw("SET LOCAL ROLE hermes_app"));
        await transaction.execute(
          sql` select set_config('hermes.user_id', ${fixture.ownerId}, true) `,
        );
        return callback(transaction as unknown as Transaction);
      });
  }

  function payment(amountCents: number, eventId: string) {
    const now = new Date();
    return {
      organizationId: fixture.organizationId,
      agentId: fixture.agentId,
      walletCardId: fixture.cardId,
      rail: "mock",
      eventId,
      railAuthorizationId: "auth-" + eventId,
      amountCents,
      currency: "HKD",
      merchantCategoryCode: null,
      merchantName: "Payment test merchant",
      mandateId: null,
      decision: "allow" as const,
      status: "approved" as const,
      reasonCode: "POLICY_ALLOWED",
      reason: "Approved by payment test",
      policyVersion: fixture.policyVersion,
      latencyMs: 2,
      receivedAt: now,
      decidedAt: now,
      reversedAt: null,
    };
  }

  it("enforces tenant foreign keys, forced RLS, and viewer mutation denial", async () => {
    const flags = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.payment_authorizations'::regclass",
    );
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    await expect(
      pool.query(
        "INSERT INTO public.wallet_cards (organization_id, agent_id, rail, rail_cardholder_id, rail_card_id, last4, brand, currency, status, policy_version) VALUES ($1, $2, 'mock', 'other', 'other-card', '4242', 'Visa', 'HKD', 'active', 1)",
        [fixture.otherOrganizationId, fixture.agentId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      appTransaction(pool, fixture.viewerId, (client) =>
        client.query(
          "INSERT INTO public.wallet_cards (organization_id, agent_id, rail, rail_cardholder_id, rail_card_id, last4, brand, currency, status, policy_version) VALUES ($1, $2, 'mock', 'viewer', 'viewer-card', '4242', 'Visa', 'HKD', 'active', 1)",
          [fixture.organizationId, fixture.agentId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("deduplicates a rail event and rejects changed bytes", async () => {
    const first = await recordPaymentAuthorization(payment(4000, "event-1"), runner());
    const replay = await recordPaymentAuthorization(payment(4000, "event-1"), runner());
    expect(replay.id).toBe(first.id);
    await expect(
      recordPaymentAuthorization(payment(999, "event-1"), runner()),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("sums approved payment spend in the supplied Hong Kong windows", async () => {
    await recordPaymentAuthorization(payment(2000, "event-2"), runner());
    const day = new Date("2026-08-18T16:00:00.000Z");
    const month = new Date("2026-08-01T16:00:00.000Z");
    const totals = await readPaymentSpendTotals(
      fixture.agentId,
      fixture.organizationId,
      day,
      month,
      runner(),
    );
    expect(totals).toEqual({ spentTodayCents: 6000, spentMonthCents: 6000 });
  });

  it("blocks identity mutation and delete", async () => {
    await expect(
      pool.query("UPDATE public.wallet_cards SET rail_card_id = 'changed' WHERE id = $1", [
        fixture.cardId,
      ]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      pool.query("DELETE FROM public.wallet_cards WHERE id = $1", [fixture.cardId]),
    ).rejects.toMatchObject({ code: "P0001" });
  });
});
