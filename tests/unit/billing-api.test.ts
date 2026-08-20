import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  createBillingCheckout: vi.fn(),
  handleBillingEvent: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/billing/service", () => ({
  createBillingCheckout: mocks.createBillingCheckout,
  handleBillingEvent: mocks.handleBillingEvent,
}));

const actor = {
  userId: "owner-1",
  email: "owner@example.com",
  name: "Owner",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Acme",
  organizationSlug: "acme",
  role: "owner" as const,
};

beforeEach(() => {
  mocks.requireActor.mockReset().mockResolvedValue(actor);
  mocks.createBillingCheckout
    .mockReset()
    .mockResolvedValue({ url: "https://checkout.stripe.test/session" });
  mocks.handleBillingEvent.mockReset().mockResolvedValue({ received: true });
});

describe("billing API contracts", () => {
  it("allows owner checkout and returns only the hosted URL", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "req-billing" },
        body: JSON.stringify({ tier: "growth", returnTo: "https://evil.example" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { url: "https://checkout.stripe.test/session" },
    });
    expect(mocks.createBillingCheckout).toHaveBeenCalledWith(actor, "growth");
  });

  it("rejects malformed tiers and never forwards browser return URLs", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ tier: "pilot", returnTo: "https://evil.example" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createBillingCheckout).not.toHaveBeenCalled();
  });

  it("verifies the raw Stripe signature before handling a webhook", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe-billing/route");
    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe-billing", {
        method: "POST",
        headers: { "stripe-signature": "sig", "x-request-id": "req-webhook" },
        body: '{"id":"evt_123"}',
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.handleBillingEvent).toHaveBeenCalledWith('{"id":"evt_123"}', "sig");
  });

  it("maps invalid signatures to a safe 400 envelope", async () => {
    mocks.handleBillingEvent.mockRejectedValue(new Error("BILLING_WEBHOOK_SIGNATURE_INVALID"));
    const { POST } = await import("@/app/api/webhooks/stripe-billing/route");
    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe-billing", {
        method: "POST",
        headers: { "stripe-signature": "bad", "x-request-id": "req-webhook-invalid" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BILLING_WEBHOOK_SIGNATURE_INVALID");
  });
});
