import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { schema } from "@/db/schema";
import type { Transaction } from "@/lib/db";
import { provisionCard, setWalletCardStatus } from "@/lib/payments/card-service";
import type { PaymentRail } from "@/lib/payments/rails";

vi.mock("server-only", () => ({}));
import {
  readPaymentSpendTotals,
  recordPaymentAuthorization,
  type PaymentTransactionRunner,
} from "@/lib/payments/postgres-store";

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
  "0007_payment_authorization_hardening.sql",
  "0008_mandate_verified_agent_boundary.sql",
  "0009_card_provisioning_transition.sql",
  "0010_wallet_card_provisioning_attempt.sql",
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
    provisionAgentId: string;
    noPolicyAgentId: string;
    retryAgentId: string;
    staleAgentId: string;
    takeoverAgentId: string;
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
    const provisionAgentId = crypto.randomUUID();
    const noPolicyAgentId = crypto.randomUUID();
    const retryAgentId = crypto.randomUUID();
    const staleAgentId = crypto.randomUUID();
    const takeoverAgentId = crypto.randomUUID();

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
    for (const [id, label] of [
      [provisionAgentId, "provision"],
      [noPolicyAgentId, "no-policy"],
      [retryAgentId, "retry"],
      [staleAgentId, "stale"],
      [takeoverAgentId, "takeover"],
    ] as const) {
      await pool.query(
        "INSERT INTO public.agents (id, organization_id, slug, did, name, role, risk, scopes, spend_cap_cents, status, credential_id, credential_jws, issued_at, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, 'operator', 'low', ARRAY['catalog.read']::text[], 100000, 'active', $6, 'test', now(), now() + interval '1 day', $7)",
        [
          id,
          organizationId,
          `payment-${label}-${crypto.randomUUID()}`,
          `did:web:payment.test:${label}:${crypto.randomUUID()}`,
          `Payment ${label} Agent`,
          `credential-${label}-${crypto.randomUUID()}`,
          ownerId,
        ],
      );
    }
    for (const id of [provisionAgentId, retryAgentId, staleAgentId, takeoverAgentId]) {
      await pool.query(
        "INSERT INTO public.agent_policies (organization_id, agent_id, version, currency, per_transaction_limit_cents, daily_limit_cents, monthly_limit_cents, approval_threshold_cents, mcc_allowlist, mcc_required, assigned_reviewer_user_id, created_by_user_id) VALUES ($1, $2, 1, 'HKD', 50000, 100000, 100000, 50000, ARRAY[]::text[], false, $3, $3)",
        [organizationId, id, ownerId],
      );
    }
    fixture = {
      organizationId,
      otherOrganizationId,
      ownerId,
      viewerId,
      agentId,
      cardId,
      policyVersion: 1,
      provisionAgentId,
      noPolicyAgentId,
      retryAgentId,
      staleAgentId,
      takeoverAgentId,
    };
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  function runner(userId = fixture.ownerId): PaymentTransactionRunner {
    const database = drizzle(pool, { schema });
    return async <T>(callback: (transaction: Transaction) => Promise<T>) =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw("SET LOCAL ROLE hermes_app"));
        await transaction.execute(sql` select set_config('hermes.user_id', ${userId}, true) `);
        await transaction.execute(sql` select set_config('hermes.agent_verified', '0', true) `);
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
    const sample = payment(4000, "event-1");
    const first = await recordPaymentAuthorization(sample, runner());
    const replay = await recordPaymentAuthorization(sample, runner());
    expect(replay.id).toBe(first.id);
    await expect(
      recordPaymentAuthorization(payment(999, "event-1"), runner()),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      recordPaymentAuthorization(
        { ...payment(4000, "event-1"), railAuthorizationId: "different-auth" },
        runner(),
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      recordPaymentAuthorization(
        { ...payment(4000, "event-1"), reason: "Different reason" },
        runner(),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects cross-tenant spend aggregate reads", async () => {
    await expect(
      readPaymentSpendTotals(
        fixture.agentId,
        fixture.organizationId,
        new Date("2026-08-18T16:00:00.000Z"),
        new Date("2026-08-01T16:00:00.000Z"),
        runner("payment-not-a-member"),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
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

  function ownerActor() {
    return {
      userId: fixture.ownerId,
      email: "owner@payments.test",
      name: "Payment Owner",
      organizationId: fixture.organizationId,
      organizationName: "Payment Test Org",
      organizationSlug: "payment-test",
      role: "owner" as const,
    };
  }

  function cardRail(options: { failFirst?: boolean; delayMs?: number } = {}) {
    let createCalls = 0;
    let statusCalls = 0;
    const cardholderIdempotencyKeys: string[] = [];
    const rail: PaymentRail = {
      name: "mock",
      async ensureCardholder(input) {
        cardholderIdempotencyKeys.push(input.idempotencyKey);
        return `holder-${input.organizationId}`;
      },
      async createVirtualCard(input) {
        createCalls += 1;
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        if (options.failFirst && createCalls === 1)
          throw new Error("provider detail must stay private");
        return {
          railCardId: `rail-card-${input.agentSlug}`,
          cardholderId: input.cardholderId,
          last4: "4242",
          brand: "Visa",
          currency: "HKD",
          status: "active",
        };
      },
      async updateCardControls() {},
      async setCardStatus() {
        statusCalls += 1;
      },
      verifyAuthorizationWebhook() {
        return null;
      },
      parseAuthorizationRequest() {
        return null;
      },
      directDecisionBody(decision) {
        return { approved: decision.approved };
      },
    };
    return {
      rail,
      createCalls: () => createCalls,
      statusCalls: () => statusCalls,
      cardholderIdempotencyKeys: () => cardholderIdempotencyKeys,
    };
  }

  it("requires an active policy before reserving a card", async () => {
    const provider = cardRail();
    await expect(
      provisionCard(ownerActor(), fixture.noPolicyAgentId, {
        rail: provider.rail,
        runTransaction: runner(),
      }),
    ).rejects.toMatchObject({ code: "POLICY_REQUIRED" });
    expect(provider.createCalls()).toBe(0);
  });

  it("provisions one card across concurrent idempotent requests", async () => {
    const provider = cardRail({ delayMs: 30 });
    const [first, second] = await Promise.all([
      provisionCard(ownerActor(), fixture.provisionAgentId, {
        rail: provider.rail,
        runTransaction: runner(),
      }),
      provisionCard(ownerActor(), fixture.provisionAgentId, {
        rail: provider.rail,
        runTransaction: runner(),
      }),
    ]);

    expect(first.card.id).toBe(second.card.id);
    expect(provider.createCalls()).toBe(1);
    expect(provider.cardholderIdempotencyKeys()).toEqual([
      expect.stringMatching(/^hermes-cardholder-[a-f0-9]{64}$/),
    ]);
    const stored = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT id, status, last4, brand FROM public.wallet_cards WHERE organization_id = $1 AND agent_id = $2",
        [fixture.organizationId, fixture.provisionAgentId],
      ),
    );
    expect(stored.rows).toEqual([
      expect.objectContaining({
        id: first.card.id,
        status: "active",
        last4: "4242",
        brand: "Visa",
      }),
    ]);
    const audits = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT count(*)::int AS count FROM public.agent_audit_logs WHERE organization_id = $1 AND agent_id = $2 AND action = 'wallet.card_provisioned'",
        [fixture.organizationId, fixture.provisionAgentId],
      ),
    );
    expect(audits.rows[0]).toMatchObject({ count: 1 });
  });

  it("cancels a failed reservation and safely reuses it on retry", async () => {
    const provider = cardRail({ failFirst: true });
    await expect(
      provisionCard(ownerActor(), fixture.retryAgentId, {
        rail: provider.rail,
        runTransaction: runner(),
      }),
    ).rejects.toMatchObject({ code: "RAIL_PROVISION_FAILED" });
    const canceled = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT id, status FROM public.wallet_cards WHERE organization_id = $1 AND agent_id = $2",
        [fixture.organizationId, fixture.retryAgentId],
      ),
    );
    expect(canceled.rows[0]).toMatchObject({ status: "canceled" });

    const retried = await provisionCard(ownerActor(), fixture.retryAgentId, {
      rail: provider.rail,
      runTransaction: runner(),
    });
    expect(retried.card.id).toBe(canceled.rows[0]?.id);
    expect(retried.card.status).toBe("active");
    expect(provider.createCalls()).toBe(2);
  });

  it("reconciles a stale provisioning reservation with deterministic provider keys", async () => {
    const staleId = crypto.randomUUID();
    const pendingId = `pending_hermes-card-${createHash("sha256")
      .update(`${fixture.organizationId}:${fixture.staleAgentId}`)
      .digest("hex")}`;
    await pool.query(
      "INSERT INTO public.wallet_cards (id, organization_id, agent_id, rail, rail_cardholder_id, rail_card_id, last4, brand, currency, status, policy_version, created_at, updated_at) VALUES ($1, $2, $3, 'mock', $4, $4, '0000', 'Pending', 'HKD', 'provisioning', 1, now() - interval '10 minutes', now() - interval '10 minutes')",
      [staleId, fixture.organizationId, fixture.staleAgentId, pendingId],
    );
    const provider = cardRail();

    const reconciled = await provisionCard(ownerActor(), fixture.staleAgentId, {
      rail: provider.rail,
      runTransaction: runner(),
    });

    expect(reconciled.card).toMatchObject({ id: staleId, status: "active", last4: "4242" });
    expect(provider.createCalls()).toBe(1);
    expect(provider.cardholderIdempotencyKeys()).toEqual([
      expect.stringMatching(/^hermes-cardholder-[a-f0-9]{64}$/),
    ]);
  });

  it("prevents an old worker from finalizing or canceling a replacement attempt", async () => {
    function gateRail() {
      let release!: () => void;
      let markStarted!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const base = cardRail();
      const rail: PaymentRail = {
        ...base.rail,
        async createVirtualCard(input) {
          markStarted();
          await released;
          return {
            railCardId: `rail-card-${input.agentSlug}`,
            cardholderId: input.cardholderId,
            last4: "4242",
            brand: "Visa",
            currency: "HKD",
            status: "active",
          };
        },
      };
      return { rail, started, release };
    }

    const first = gateRail();
    const firstOutcome = provisionCard(ownerActor(), fixture.takeoverAgentId, {
      rail: first.rail,
      runTransaction: runner(),
    }).then(
      (value) => value,
      (error: unknown) => error,
    );
    await first.started;
    const firstReservation = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT id, provisioning_token FROM public.wallet_cards WHERE organization_id = $1 AND agent_id = $2",
        [fixture.organizationId, fixture.takeoverAgentId],
      ),
    );
    const firstToken = String(firstReservation.rows[0]?.provisioning_token);
    await pool.query(
      "UPDATE public.wallet_cards SET updated_at = now() - interval '10 minutes' WHERE id = $1",
      [firstReservation.rows[0]?.id],
    );

    const second = gateRail();
    const secondOutcome = provisionCard(ownerActor(), fixture.takeoverAgentId, {
      rail: second.rail,
      runTransaction: runner(),
    });
    await second.started;
    const replacement = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT status, provisioning_token FROM public.wallet_cards WHERE organization_id = $1 AND agent_id = $2",
        [fixture.organizationId, fixture.takeoverAgentId],
      ),
    );
    expect(replacement.rows[0]).toMatchObject({ status: "provisioning" });
    expect(replacement.rows[0]?.provisioning_token).not.toBe(firstToken);

    first.release();
    await expect(firstOutcome).resolves.toMatchObject({ code: "RAIL_PROVISION_FAILED" });
    const afterOldWorker = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT status, provisioning_token FROM public.wallet_cards WHERE organization_id = $1 AND agent_id = $2",
        [fixture.organizationId, fixture.takeoverAgentId],
      ),
    );
    expect(afterOldWorker.rows[0]).toEqual(replacement.rows[0]);

    second.release();
    await expect(secondOutcome).resolves.toMatchObject({ card: { status: "active" } });
    const finalState = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT status, provisioning_token FROM public.wallet_cards WHERE organization_id = $1 AND agent_id = $2",
        [fixture.organizationId, fixture.takeoverAgentId],
      ),
    );
    expect(finalState.rows[0]).toEqual({ status: "active", provisioning_token: null });
  });
  it("freezes and unfreezes a card with one audit row per status mutation", async () => {
    const provider = cardRail();
    const cards = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT id FROM public.wallet_cards WHERE organization_id = $1 AND agent_id = $2",
        [fixture.organizationId, fixture.provisionAgentId],
      ),
    );
    const cardId = String(cards.rows[0]?.id);
    const frozen = await setWalletCardStatus(ownerActor(), cardId, "frozen", {
      rail: provider.rail,
      runTransaction: runner(),
    });
    expect(frozen).toMatchObject({ status: "frozen", last4: "4242" });
    const active = await setWalletCardStatus(ownerActor(), cardId, "active", {
      rail: provider.rail,
      runTransaction: runner(),
    });
    expect(active.status).toBe("active");
    expect(provider.statusCalls()).toBe(2);

    const audits = await appTransaction(pool, fixture.ownerId, (client) =>
      client.query(
        "SELECT action FROM public.agent_audit_logs WHERE organization_id = $1 AND agent_id = $2 AND action IN ('wallet.card_frozen', 'wallet.card_unfrozen') ORDER BY chain_position",
        [fixture.organizationId, fixture.provisionAgentId],
      ),
    );
    expect(audits.rows.map((row) => row.action)).toEqual([
      "wallet.card_frozen",
      "wallet.card_unfrozen",
    ]);
  });
});
