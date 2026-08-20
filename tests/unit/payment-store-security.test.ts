import { describe, expect, it, vi } from "vitest";

import type {
  PaymentAuthorizationInput,
  PaymentTransactionRunner,
} from "@/lib/payments/postgres-store";

const SAMPLE: PaymentAuthorizationInput = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  agentId: "00000000-0000-0000-0000-000000000002",
  walletCardId: "00000000-0000-0000-0000-000000000003",
  rail: "mock",
  eventId: "event-security-1",
  railAuthorizationId: "rail-auth-1",
  amountCents: 1200,
  currency: "HKD",
  merchantCategoryCode: "5734",
  merchantName: "Example",
  mandateId: null,
  decision: "allow",
  status: "approved",
  reasonCode: "POLICY_ALLOWED",
  reason: "Allowed",
  policyVersion: 1,
  latencyMs: 4,
  receivedAt: new Date("2026-08-18T01:00:00.000Z"),
  decidedAt: new Date("2026-08-18T01:00:00.004Z"),
  reversedAt: null,
};

const stored = {
  id: "payment-1",
  organization_id: SAMPLE.organizationId,
  agent_id: SAMPLE.agentId,
  wallet_card_id: SAMPLE.walletCardId,
  rail: SAMPLE.rail,
  event_id: SAMPLE.eventId,
  rail_authorization_id: SAMPLE.railAuthorizationId,
  amount_cents: SAMPLE.amountCents,
  currency: SAMPLE.currency,
  merchant_category_code: SAMPLE.merchantCategoryCode,
  merchant_name: SAMPLE.merchantName,
  mandate_id: null,
  decision: SAMPLE.decision,
  status: SAMPLE.status,
  reason_code: SAMPLE.reasonCode,
  reason: SAMPLE.reason,
  policy_version: SAMPLE.policyVersion,
  latency_ms: SAMPLE.latencyMs,
  received_at: SAMPLE.receivedAt,
  decided_at: SAMPLE.decidedAt,
  reversed_at: null,
};

function authenticatedRunner(): PaymentTransactionRunner {
  return async (callback) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { user_id: "payment-user", agent_verified: "0", agent_id: "", agent_organization_id: "" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [stored] });
    return callback({ execute } as never);
  };
}

describe("payment store security remediation", () => {
  it("exposes an authenticated actor-aware transaction runner", async () => {
    const paymentStore = await import("@/lib/payments/postgres-store");
    expect(paymentStore.createPaymentTransactionRunner).toEqual(expect.any(Function));
  });

  it("rejects a replay whose rail identity or decision bytes changed", async () => {
    const paymentStore = await import("@/lib/payments/postgres-store");
    await expect(
      paymentStore.recordPaymentAuthorization(
        { ...SAMPLE, railAuthorizationId: "different-rail-auth" },
        authenticatedRunner(),
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      paymentStore.recordPaymentAuthorization(
        { ...SAMPLE, reason: "Different reason" },
        authenticatedRunner(),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
