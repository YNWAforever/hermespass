import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const execute = vi.fn();
  const withPublicDatabase = vi.fn(async (callback: (database: unknown) => Promise<unknown>) =>
    callback({
      transaction: async (transactionCallback: (transaction: unknown) => Promise<unknown>) =>
        transactionCallback({ execute }),
    }),
  );

  return { execute, withPublicDatabase };
});

vi.mock("@/lib/db", () => ({
  withPublicDatabase: mocks.withPublicDatabase,
}));

import {
  readPaymentSpendTotals,
  recordPaymentAuthorization,
  type PaymentAuthorizationInput,
  type PaymentTransactionRunner,
} from "@/lib/payments/postgres-store";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const AGENT_ID = "20000000-0000-4000-8000-000000000001";
const CARD_ID = "30000000-0000-4000-8000-000000000001";

function paymentInput(): PaymentAuthorizationInput {
  const now = new Date("2026-08-18T04:03:02.000Z");
  return {
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_ID,
    walletCardId: CARD_ID,
    rail: "mock",
    eventId: "event-1",
    railAuthorizationId: "auth-event-1",
    amountCents: 4_000,
    currency: "HKD",
    merchantCategoryCode: null,
    merchantName: "Payment store test merchant",
    mandateId: null,
    decision: "allow",
    status: "approved",
    reasonCode: "POLICY_ALLOWED",
    reason: "Approved by payment store test",
    policyVersion: 1,
    latencyMs: 2,
    receivedAt: now,
    decidedAt: now,
    reversedAt: null,
  };
}
function explicitRunner(execute: (query: unknown) => Promise<unknown>): PaymentTransactionRunner {
  return (async <T>(callback: (transaction: { execute: typeof execute }) => Promise<T>) =>
    callback({ execute })) as unknown as PaymentTransactionRunner;
}
describe("payment postgres store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockReset();
    mocks.withPublicDatabase.mockClear();
  });

  it("rejects default-runner writes without an authenticated user or verified agent claim", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          user_id: "",
          agent_verified: "0",
          agent_id: "",
          agent_organization_id: "",
        },
      ],
    });

    await expect(recordPaymentAuthorization(paymentInput())).rejects.toThrow(
      "PAYMENT_ACTOR_CONTEXT_REQUIRED",
    );
  });

  it("rejects explicit-runner reads without an authenticated user or verified agent claim", async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          user_id: "",
          agent_verified: "0",
          agent_id: "",
          agent_organization_id: "",
        },
      ],
    });

    await expect(
      readPaymentSpendTotals(
        AGENT_ID,
        ORGANIZATION_ID,
        new Date("2026-08-18T16:00:00.000Z"),
        new Date("2026-08-01T16:00:00.000Z"),
        explicitRunner(execute),
      ),
    ).rejects.toThrow("PAYMENT_ACTOR_CONTEXT_REQUIRED");
  });

  it("allows matching verified-agent claims without a user session", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: "",
            agent_verified: "1",
            agent_id: AGENT_ID,
            agent_organization_id: ORGANIZATION_ID,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ spent_today_cents: 1_200, spent_month_cents: 5_000 }],
      });

    await expect(
      readPaymentSpendTotals(
        AGENT_ID,
        ORGANIZATION_ID,
        new Date("2026-08-18T16:00:00.000Z"),
        new Date("2026-08-01T16:00:00.000Z"),
        explicitRunner(execute),
      ),
    ).resolves.toEqual({ spentTodayCents: 1_200, spentMonthCents: 5_000 });
  });
});
