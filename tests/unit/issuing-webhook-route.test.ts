import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payments/rails", () => ({
  activePaymentRail: () => ({
    name: "mock",
    verifyAuthorizationWebhook: (payload: string, signature: string | null) => {
      if (signature !== "mock-signature") throw new Error("PAYMENT_WEBHOOK_SIGNATURE_INVALID");
      return {
        eventId: "evt-1",
        railAuthorizationId: "auth-1",
        railCardId: "card-1",
        amountCents: 2000,
        currency: "HKD",
        merchantCategoryCode: "5734",
        merchantName: "AWS",
        receivedAt: new Date("2026-08-19T00:00:00.000Z"),
      };
    },
    directDecisionBody: () => ({ approved: true }),
  }),
}));
vi.mock("@/lib/payments/authorization-store", () => ({
  createPostgresAuthorizationStore: () => ({
    authorize: async () => ({
      authorizationId: "a",
      approved: true,
      reasonCode: "PAYMENT_ALLOWED",
      reason: "ok",
      mandateId: null,
      policyVersion: 1,
      decidedAt: new Date().toISOString(),
      latencyMs: 1,
    }),
  }),
}));

import { POST } from "@/app/api/webhooks/issuing/route";

describe("issuing webhook route", () => {
  it("reads the raw body once and returns the direct approved boolean", async () => {
    const request = new Request("http://localhost/api/webhooks/issuing", {
      method: "POST",
      headers: { "stripe-signature": "mock-signature" },
      body: JSON.stringify({
        type: "mock.issuing_authorization.request",
        id: "evt-1",
        authorization: {
          id: "auth-1",
          cardId: "card-1",
          amountCents: 2000,
          currency: "HKD",
          merchantCategoryCode: "5734",
          merchantName: "AWS",
        },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ approved: expect.any(Boolean) });
  });

  it("rejects an invalid webhook signature", async () => {
    const request = new Request("http://localhost/api/webhooks/issuing", {
      method: "POST",
      headers: { "stripe-signature": "bad" },
      body: "{}",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
  });

  it("rejects malformed UTF-8 as a webhook validation error", async () => {
    const request = new Request("http://localhost/api/webhooks/issuing", {
      method: "POST",
      headers: { "stripe-signature": "mock-signature" },
      body: new Uint8Array([0xff, 0xfe]),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
  });
});
