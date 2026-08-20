import { describe, expect, it } from "vitest";

import {
  authorizePayment,
  type PaymentAuthorizationStore,
} from "@/lib/payments/authorization-service";
import type { PaymentAuthorizationInput } from "@/lib/payments/rails/types";

const input: PaymentAuthorizationInput & { mandateId?: string } = {
  eventId: "evt-1",
  railAuthorizationId: "auth-1",
  railCardId: "card-1",
  amountCents: 2_000,
  currency: "HKD",
  merchantCategoryCode: "5734",
  merchantName: "AWS",
  receivedAt: new Date("2026-08-19T00:00:00.000Z"),
  mandateId: "fbb9a6a1-2d6b-4f4c-8c29-6c7c4f0a54dd",
};

function store(overrides: Partial<PaymentAuthorizationStore> = {}): PaymentAuthorizationStore {
  return {
    authorize: async () => ({
      authorizationId: "auth-row",
      approved: true,
      reasonCode: "PAYMENT_ALLOWED",
      reason: "Payment authorized.",
      mandateId: "fbb9a6a1-2d6b-4f4c-8c29-6c7c4f0a54dd",
      policyVersion: 1,
      decidedAt: "2026-08-19T00:00:00.000Z",
      latencyMs: 10,
    }),
    ...overrides,
  };
}

describe("payment authorization", () => {
  it("allows one matching HKD charge and returns a safe DTO", async () => {
    const result = await authorizePayment(input, store());
    expect(result).toMatchObject({ approved: true, reasonCode: "PAYMENT_ALLOWED" });
    expect(result).not.toHaveProperty("merchantName");
  });

  it("fails closed for unsupported currency before any rail work", async () => {
    const calls: string[] = [];
    const result = await authorizePayment(
      { ...input, currency: "USD" },
      store({
        authorize: async () => {
          calls.push("authorize");
          return {
            authorizationId: "x",
            approved: false,
            reasonCode: "RAIL_CURRENCY_UNSUPPORTED",
            reason: "HKD only.",
            mandateId: null,
            policyVersion: null,
            decidedAt: new Date().toISOString(),
            latencyMs: 0,
          };
        },
      }),
    );
    expect(result.reasonCode).toBe("RAIL_CURRENCY_UNSUPPORTED");
    expect(calls).toHaveLength(1);
  });
});
