import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payments/rails", () => ({
  activePaymentRail: () => ({
    name: "mock",
    verifyAuthorizationWebhook: (_payload: string, signature: string | null) => {
      if (signature !== "mock-signature") throw new Error("PAYMENT_WEBHOOK_SIGNATURE_INVALID");
      return null;
    },
  }),
}));

const recordEvent = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/lib/payments/payment-events-store", () => ({
  createPostgresPaymentEventStore: () => ({ record: recordEvent }),
}));

import { POST } from "@/app/api/webhooks/issuing/events/route";

describe("issuing event webhook route", () => {
  beforeEach(() => recordEvent.mockClear());
  it("persists only safe metadata for a signed non-authorization event", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/issuing/events", {
        method: "POST",
        headers: { "stripe-signature": "mock-signature" },
        body: JSON.stringify({
          type: "mock.issuing_authorization.updated",
          id: "evt-1",
          data: { object: { id: "auth-1", status: "approved", amount: 2000, currency: "hkd" } },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        rail: "mock",
        eventId: "evt-1",
        railAuthorizationId: "auth-1",
        amountCents: 2000,
        currency: "HKD",
      }),
    );
  });

  it("rejects an oversized streaming body before parsing", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/issuing/events", {
        method: "POST",
        headers: { "stripe-signature": "mock-signature", "content-length": "16385" },
        body: "x".repeat(16 * 1_024 + 1),
      }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("REQUEST_TOO_LARGE");
    expect(recordEvent).not.toHaveBeenCalledWith(expect.anything());
  });
  it("rejects an invalid signature", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/issuing/events", {
        method: "POST",
        headers: { "stripe-signature": "bad" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
  });
});
