import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import type { Transaction } from "@/lib/db";
import { authorizePayment } from "@/lib/payments/authorization-service";
import {
  createPostgresAuthorizationStore,
  type AuthorizationTransactionRunner,
} from "@/lib/payments/authorization-store";
import { createPostgresPaymentEventStore } from "@/lib/payments/payment-events-store";
import type { PaymentAuthorizationInput } from "@/lib/payments/rails/types";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const required = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;

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
];

if (required) {
  describe("payment authorization PostgreSQL configuration", () => {
    it("requires DATABASE_URL_TEST", () => {
      expect(databaseUrl).toBeTruthy();
    });
  });
}

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
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await client.query("SELECT set_config('hermes.user_id', $1, true)", [userId]);
    const result = await callback(client);
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

type Fixture = {
  organizationId: string;
  ownerId: string;
  agentId: string;
  cardId: string;
  keyId: string;
  mandateIds: string[];
};

function authorization(
  fixture: Fixture,
  eventId: string,
  amountCents: number,
): PaymentAuthorizationInput {
  return {
    rail: "mock",
    eventId,
    railAuthorizationId: `auth-${eventId}`,
    railCardId: "payment-card-1",
    amountCents,
    currency: "HKD",
    merchantCategoryCode: "5734",
    merchantName: "Payment Test Merchant",
    mandateId: fixture.mandateIds.shift() ?? null,
    receivedAt: new Date(),
  };
}

dbTest("payment authorization transaction boundary", () => {
  let pool: Pool;
  let fixture: Fixture;
  let runTransaction: AuthorizationTransactionRunner;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    await resetAndMigrate(pool);

    const organizationId = crypto.randomUUID();
    const ownerId = `payment-owner-${crypto.randomUUID()}`;
    const agentId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const keyId = crypto.randomUUID();
    const mandateIds = Array.from({ length: 12 }, () => crypto.randomUUID());

    await pool.query("INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)", [
      organizationId,
      "Authorization Test Org",
      `authorization-${crypto.randomUUID()}`,
    ]);
    await pool.query(
      "INSERT INTO org_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [organizationId, ownerId],
    );
    await pool.query(
      `INSERT INTO agents (id, organization_id, slug, did, name, role, risk, scopes,
       spend_cap_cents, status, credential_id, credential_jws, issued_at, expires_at, created_by)
       VALUES ($1, $2, $3, $4, 'Authorization Agent', 'operator', 'low', ARRAY['checkout.external']::text[],
       100000, 'active', $5, 'test-credential', now(), now() + interval '1 day', $6)`,
      [
        agentId,
        organizationId,
        `authorization-agent-${crypto.randomUUID()}`,
        `did:web:authorization.test:${crypto.randomUUID()}`,
        `credential-${crypto.randomUUID()}`,
        ownerId,
      ],
    );
    await pool.query(
      `INSERT INTO agent_keys (id, agent_id, organization_id, key_fragment, public_jwk,
       thumbprint, custody, status)
       VALUES ($1, $2, $3, 'payment-key-1', $4::jsonb, 'payment-thumbprint', 'external', 'active')`,
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
      `INSERT INTO agent_policies (organization_id, agent_id, version, currency,
       per_transaction_limit_cents, daily_limit_cents, monthly_limit_cents,
       approval_threshold_cents, mcc_allowlist, mcc_required, assigned_reviewer_user_id, created_by_user_id)
       VALUES ($1, $2, 1, 'HKD', 10000, 10000, 10000, 10000, ARRAY[]::text[], false, $3, $3)`,
      [organizationId, agentId, ownerId],
    );
    await pool.query(
      `INSERT INTO wallet_cards (id, organization_id, agent_id, rail, rail_cardholder_id,
       rail_card_id, last4, brand, currency, status, policy_version)
       VALUES ($1, $2, $3, 'mock', 'payment-holder-1', 'payment-card-1', '4242', 'Visa', 'HKD', 'active', 1)`,
      [cardId, organizationId, agentId],
    );
    for (const mandateId of mandateIds) {
      await pool.query(
        `INSERT INTO mandates (id, organization_id, agent_id, key_id, agent_did, key_thumbprint, version, nonce, kind,
         body, signature, body_digest, currency, max_amount_cents, merchant, mcc_allowlist,
         one_time, issued_at, expires_at, status)
         VALUES ($1, $2, $3, $4, 'did:web:authorization.test', 'payment-thumbprint', 1, $5, 'intent', $6::jsonb, $7, $8, 'HKD', 10000,
         'Payment Test Merchant', ARRAY['5734']::text[], true, now(), now() + interval '1 hour', 'active')`,
        [
          mandateId,
          organizationId,
          agentId,
          keyId,
          `nonce-${mandateId}`,
          JSON.stringify({ version: "1" }),
          Buffer.alloc(64),
          Buffer.alloc(32),
        ],
      );
    }
    fixture = { organizationId, ownerId, agentId, cardId, keyId, mandateIds };
    const database = drizzle(pool, { schema });
    runTransaction = async <T>(callback: (transaction: Transaction) => Promise<T>) =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw("SET LOCAL ROLE hermes_app"));
        await transaction.execute(sql`select set_config('hermes.user_id', ${ownerId}, true)`);
        return callback(transaction as unknown as Transaction);
      });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("authorizes a matching mandate and appends exactly one audit row", async () => {
    const store = createPostgresAuthorizationStore(runTransaction);
    const input = authorization(fixture, `evt-${crypto.randomUUID()}`, 2_000);
    const result = await authorizePayment(input, store);
    expect(result.approved).toBe(true);
    expect(result.reasonCode).toBe("PAYMENT_ALLOWED");

    const audit = await pool.query(
      "SELECT count(*)::int AS count FROM agent_audit_logs WHERE organization_id = $1 AND action = 'payment.authorization'",
      [fixture.organizationId],
    );
    expect(audit.rows[0]?.count).toBe(1);

    const verification = await appTransaction(pool, fixture.ownerId, async (client) =>
      client.query<{ valid: boolean }>("SELECT valid FROM hermes_verify_audit_chain($1)", [
        fixture.organizationId,
      ]),
    );
    expect(verification.rows[0]?.valid).toBe(true);
  });

  it("records an idempotent provider reversal and one reversal audit", async () => {
    const input = authorization(fixture, `reverse-${crypto.randomUUID()}`, 500);
    const initial = await authorizePayment(input, createPostgresAuthorizationStore(runTransaction));
    expect(initial.approved).toBe(true);
    const eventStore = createPostgresPaymentEventStore(runTransaction);
    const event = {
      rail: "mock",
      eventId: `provider-reversal-${crypto.randomUUID()}`,
      type: "issuing_transaction.created" as const,
      railAuthorizationId: input.railAuthorizationId,
      status: "reversed" as const,
      amountCents: input.amountCents,
      currency: input.currency,
      occurredAt: new Date(),
    };
    expect(await eventStore.record(event)).toBe(true);
    expect(await eventStore.record(event)).toBe(false);
    const payment = await pool.query<{ status: string }>(
      "SELECT status FROM payment_authorizations WHERE rail = $1 AND rail_authorization_id = $2",
      [event.rail, event.railAuthorizationId],
    );
    const audit = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM agent_audit_logs WHERE organization_id = $1 AND action = 'payment.authorization_reversed' AND payload->>'eventId' = $2",
      [fixture.organizationId, event.eventId],
    );
    expect(payment.rows[0]?.status).toBe("reversed");
    expect(audit.rows[0]?.count).toBe(1);
    const auditPayload = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM agent_audit_logs WHERE organization_id = $1 AND action = 'payment.authorization' LIMIT 1",
      [fixture.organizationId],
    );
    expect(auditPayload.rows[0]?.payload["payloadDigest"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("serializes duplicate provider delivery to one audit event", async () => {
    const input = authorization(fixture, `provider-race-auth-${crypto.randomUUID()}`, 500);
    const initial = await authorizePayment(input, createPostgresAuthorizationStore(runTransaction));
    expect(initial.approved).toBe(true);
    const eventStore = createPostgresPaymentEventStore(runTransaction);
    const event = {
      rail: "mock",
      eventId: `provider-race-${crypto.randomUUID()}`,
      type: "issuing_authorization.updated" as const,
      railAuthorizationId: input.railAuthorizationId,
      status: "approved" as const,
      amountCents: input.amountCents,
      currency: input.currency,
      occurredAt: new Date(),
    };
    const results = await Promise.all([eventStore.record(event), eventStore.record(event)]);
    expect(results.sort()).toEqual([false, true]);
    const audit = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM agent_audit_logs WHERE organization_id = $1 AND action = 'payment.provider_event' AND payload->>'eventId' = $2",
      [fixture.organizationId, event.eventId],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });
  it("replays the same event without a second authorization or audit row", async () => {
    const store = createPostgresAuthorizationStore(runTransaction);
    const input: PaymentAuthorizationInput = {
      ...authorization(fixture, `replay-${crypto.randomUUID()}`, 1_000),
      mandateId: null,
    };
    const first = await authorizePayment(input, store);
    const second = await authorizePayment(input, store);
    expect(second).toEqual(first);

    const rows = await pool.query(
      "SELECT count(*)::int AS count FROM payment_authorizations WHERE rail = 'mock' AND event_id = $1",
      [input.eventId],
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("rejects a replay with the same event but different authorization bytes", async () => {
    const store = createPostgresAuthorizationStore(runTransaction);
    const input: PaymentAuthorizationInput = {
      ...authorization(fixture, `conflict-${crypto.randomUUID()}`, 1_000),
    };
    await authorizePayment(input, store);
    await expect(
      authorizePayment(
        { ...input, railAuthorizationId: `${input.railAuthorizationId}-changed` },
        store,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_EVENT_CONFLICT" });
  });
  it("serializes concurrent authorizations against the daily cap", async () => {
    const first = authorization(fixture, `cap-a-${crypto.randomUUID()}`, 6_000);
    const second = authorization(fixture, `cap-b-${crypto.randomUUID()}`, 6_000);
    const storeA = createPostgresAuthorizationStore(runTransaction);
    const storeB = createPostgresAuthorizationStore(runTransaction);
    const [a, b] = await Promise.all([
      authorizePayment(first, storeA),
      authorizePayment(second, storeB),
    ]);
    expect([a.approved, b.approved].sort()).toEqual([false, true]);
  });

  it("rolls back payment and mandate state when audit append fails", async () => {
    const input = authorization(fixture, `audit-failure-${crypto.randomUUID()}`, 500);
    const mandateId = input.mandateId;
    if (!mandateId) throw new Error("test mandate missing");
    await pool.query(`
      CREATE FUNCTION public.payment_test_fail_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'payment.authorization' THEN
          RAISE EXCEPTION 'injected payment audit failure' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER zz_payment_test_fail_audit
      BEFORE INSERT ON public.agent_audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.payment_test_fail_audit()
    `);
    try {
      await expect(
        authorizePayment(input, createPostgresAuthorizationStore(runTransaction)),
      ).rejects.toThrow();
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS zz_payment_test_fail_audit ON public.agent_audit_logs",
      );
      await pool.query("DROP FUNCTION IF EXISTS public.payment_test_fail_audit()");
    }
    const mandate = await pool.query<{ status: string }>(
      "SELECT status FROM mandates WHERE id = $1",
      [mandateId],
    );
    const payment = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM payment_authorizations WHERE rail_authorization_id = $1",
      [input.railAuthorizationId],
    );
    expect(mandate.rows[0]?.status).toBe("active");
    expect(payment.rows[0]?.count).toBe(0);
  });
  it("declines a card persisted in a non-HKD currency", async () => {
    const input = authorization(fixture, `card-currency-${crypto.randomUUID()}`, 500);
    await pool.query("UPDATE wallet_cards SET currency = 'USD' WHERE id = $1", [fixture.cardId]);
    try {
      const result = await authorizePayment(
        input,
        createPostgresAuthorizationStore(runTransaction),
      );
      expect(result.approved).toBe(false);
      expect(result.reasonCode).toBe("RAIL_CURRENCY_UNSUPPORTED");
    } finally {
      await pool.query("UPDATE wallet_cards SET currency = 'HKD' WHERE id = $1", [fixture.cardId]);
    }
  });
  it("keeps authorization latency bounded on the local transaction path", async () => {
    const started = performance.now();
    const result = await authorizePayment(
      { ...authorization(fixture, `latency-${crypto.randomUUID()}`, 500), mandateId: null },
      createPostgresAuthorizationStore(runTransaction),
    );
    expect(result.reasonCode).toBe("MANDATE_REQUIRED");
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
