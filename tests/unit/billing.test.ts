import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    customers: { create: vi.fn(), update: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  },
  withPublicDatabase: vi.fn(),
  withActorTransaction: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn(function StripeMock() {
    return mocks.client;
  }),
}));
vi.mock("@/lib/db", () => ({
  withPublicDatabase: mocks.withPublicDatabase,
  withActorTransaction: mocks.withActorTransaction,
}));

vi.mock("@/lib/auth/authorization", () => ({
  withActorTransaction: mocks.withActorTransaction,
}));

describe("Stripe billing adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(mocks.client.customers)) mock.mockReset();
    mocks.client.checkout.sessions.create.mockReset();
    mocks.client.webhooks.constructEvent.mockReset();
    mocks.withPublicDatabase.mockReset();
    mocks.withActorTransaction.mockReset();
    process.env["STRIPE_SECRET_KEY"] = "sk_test_hermes";
    process.env["STRIPE_BILLING_WEBHOOK_SECRET"] = "whsec_hermes";
    process.env["STRIPE_PRICE_STARTER"] = "price_starter";
    process.env["STRIPE_PRICE_GROWTH"] = "price_growth";
    process.env["STRIPE_PRICE_SCALE"] = "price_scale";
    process.env["HERMES_ISSUER_ORIGIN"] = "https://hermespass.asia";
  });

  it("constructs Stripe lazily and fails closed when the secret is missing", async () => {
    const { stripeBillingClient } = await import("@/lib/billing/service");
    delete process.env["STRIPE_SECRET_KEY"];
    expect(() => stripeBillingClient()).toThrow("STRIPE_SECRET_KEY is required for billing");
  });

  it("maps only the configured exact price ids", async () => {
    const { tierForPrice } = await import("@/lib/billing/service");
    expect(tierForPrice("price_starter")).toBe("starter");
    expect(tierForPrice("price_growth")).toBe("growth");
    expect(tierForPrice("price_scale")).toBe("scale");
    expect(tierForPrice("price_starter_extra")).toBeNull();
  });

  it("builds fixed same-origin success and cancel URLs without accepting returnTo", async () => {
    const { billingReturnUrls } = await import("@/lib/billing/service");
    expect(billingReturnUrls()).toEqual({
      successUrl: "https://hermespass.asia/dashboard?billing=success",
      cancelUrl: "https://hermespass.asia/dashboard?billing=cancel",
    });
  });

  it("creates a subscription checkout with the exact mapped price and safe metadata", async () => {
    const { createBillingCheckout } = await import("@/lib/billing/service");
    const actor = {
      userId: "owner-1",
      email: "owner@example.com",
      name: "Owner",
      organizationId: "11111111-1111-4111-8111-111111111111",
      organizationName: "Acme",
      organizationSlug: "acme",
      role: "owner" as const,
    };
    const tx = { execute: vi.fn() };
    mocks.withActorTransaction.mockImplementation(async (_actor, callback) => callback(tx));
    tx.execute
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: null }] })
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_123" }] });
    mocks.client.customers.create.mockResolvedValue({ id: "cus_123" });
    mocks.client.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.test/session",
    });

    const result = await createBillingCheckout(actor, "growth");
    expect(result).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(mocks.client.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_123",
        line_items: [{ price: "price_growth", quantity: 1 }],
      }),
    );
    expect(JSON.stringify(mocks.client.checkout.sessions.create.mock.calls)).not.toContain("agent");
  });

  it("allows only the owner to start checkout", async () => {
    const { createBillingCheckout } = await import("@/lib/billing/service");
    const viewer = {
      userId: "viewer-1",
      email: "viewer@example.com",
      name: "Viewer",
      organizationId: "11111111-1111-4111-8111-111111111111",
      organizationName: "Acme",
      organizationSlug: "acme",
      role: "viewer" as const,
    };
    await expect(createBillingCheckout(viewer, "starter")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("handles a signed subscription event once and ignores the duplicate", async () => {
    const { handleBillingEvent } = await import("@/lib/billing/service");
    mocks.client.webhooks.constructEvent.mockReturnValue({
      id: "evt_123",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "active",
          items: { data: [{ price: { id: "price_growth" } }] },
        },
      },
    });
    const fakeTx = { execute: vi.fn() };
    fakeTx.execute
      .mockResolvedValueOnce({
        rows: [{ organization_id: "11111111-1111-4111-8111-111111111111" }],
      })
      .mockResolvedValueOnce({ rows: [{ inserted: true }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.withPublicDatabase.mockImplementation(async (callback) =>
      callback({
        transaction: async (fn: (innerTx: typeof fakeTx) => Promise<unknown>) => fn(fakeTx),
      }),
    );
    expect(await handleBillingEvent(JSON.stringify({ id: "evt_123" }), "sig")).toEqual({
      received: true,
    });
    fakeTx.execute.mockReset();
    fakeTx.execute
      .mockResolvedValueOnce({
        rows: [{ organization_id: "11111111-1111-4111-8111-111111111111" }],
      })
      .mockResolvedValueOnce({ rows: [{ inserted: false }] });
    expect(await handleBillingEvent(JSON.stringify({ id: "evt_123" }), "sig")).toEqual({
      received: true,
    });
    expect(fakeTx.execute).toHaveBeenCalledTimes(2);
  });
});
