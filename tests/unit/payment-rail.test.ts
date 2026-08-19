import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { configuredPaymentRail, requireStripeTestKey } from "@/lib/payments/rail-config";
import { activePaymentRail } from "@/lib/payments/rails";
import { mockRail } from "@/lib/payments/rails/mock";
import { STRIPE_API_VERSION, createStripePaymentRail } from "@/lib/payments/rails/stripe";

vi.mock("server-only", () => ({}));

const organizationId = "1d2f8780-4f8d-4b5e-9bd0-10c6615c0d70";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("payment rail configuration", () => {
  it("defaults to Stripe while requiring a test key before SDK construction", async () => {
    vi.stubEnv("PAYMENT_RAIL", "stripe");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_never-use");

    expect(configuredPaymentRail()).toBe("stripe");
    expect(requireStripeTestKey).toThrow("PAYMENT_RAIL_TEST_KEY_REQUIRED");
    await expect(
      activePaymentRail().ensureCardholder({
        organizationId,
        organizationName: "HermesPass",
        idempotencyKey: "hermes-cardholder-test",
      }),
    ).rejects.toThrow("PAYMENT_RAIL_TEST_KEY_REQUIRED");
  });

  it("rejects unknown rail configuration rather than selecting a provider", () => {
    vi.stubEnv("PAYMENT_RAIL", "unknown");
    expect(() => configuredPaymentRail()).toThrow();
  });

  it.each(["airwallex", "nium"] as const)("keeps %s disabled", (rail) => {
    vi.stubEnv("PAYMENT_RAIL", rail);
    expect(() => activePaymentRail()).toThrow("PAYMENT_RAIL_PROVIDER_DISABLED");
  });

  it("pins the Stripe API version in source", () => {
    expect(STRIPE_API_VERSION).toBe("2026-03-25.dahlia");
  });
});

describe("Stripe test adapter", () => {
  it("parses only safe fields from an issuing authorization request", () => {
    const rail = createStripePaymentRail();
    const parsed = rail.parseAuthorizationRequest({
      id: "evt_test_authorization",
      type: "issuing_authorization.request",
      data: {
        object: {
          id: "iauth_test",
          card: { id: "ic_test" },
          amount: 1250,
          currency: "hkd",
          merchant_data: { category_code: "5734", name: "Hermes Cafe", raw_secret: "drop" },
          raw_secret: "drop",
        },
      },
    });
    expect(parsed).toMatchObject({
      eventId: "evt_test_authorization",
      railAuthorizationId: "iauth_test",
      railCardId: "ic_test",
      amountCents: 1250,
      currency: "HKD",
      merchantCategoryCode: "5734",
      merchantName: "Hermes Cafe",
      receivedAt: expect.any(Date),
    });
    expect(parsed).not.toHaveProperty("raw_secret");
  });

  it("fails webhook verification before constructing Stripe for missing signatures", () => {
    const rail = createStripePaymentRail();
    expect(() => rail.verifyAuthorizationWebhook("{}", null)).toThrow(
      "PAYMENT_WEBHOOK_SIGNATURE_REQUIRED",
    );
    expect(() => rail.verifyAuthorizationWebhook("x".repeat(16 * 1024 + 1), "sig")).toThrow(
      "PAYMENT_WEBHOOK_TOO_LARGE",
    );
  });

  it("requires the Stripe webhook secret only when the adapter verifies an event", () => {
    const rail = createStripePaymentRail();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_never-use");
    vi.stubEnv("STRIPE_ISSUING_WEBHOOK_SECRET", "");
    expect(() => rail.verifyAuthorizationWebhook("{}", "sig")).toThrow(
      "STRIPE_ISSUING_WEBHOOK_SECRET_REQUIRED",
    );
  });
});

describe("deterministic mock payment rail", () => {
  it("creates deterministic non-secret HKD card metadata", async () => {
    const card = await mockRail.createVirtualCard({
      cardholderId: "mock-org",
      agentSlug: "demo-agent",
      policyVersion: 1,
      currency: "HKD",
      idempotencyKey: "test-card-create-hkd",
    });

    expect(card).toMatchObject({
      railCardId: "mock_card_demo-agent",
      cardholderId: "mock-org",
      last4: "4242",
      brand: "Visa",
      currency: "HKD",
      status: "active",
    });
    expect(card).not.toHaveProperty("number");
    expect(card).not.toHaveProperty("cvc");
  });

  it("fails closed for a non-HKD card request", async () => {
    await expect(
      mockRail.createVirtualCard({
        cardholderId: "mock-org",
        agentSlug: "demo-agent",
        policyVersion: 1,
        currency: "USD",
        idempotencyKey: "test-card-create-usd",
      }),
    ).rejects.toThrow("PAYMENT_RAIL_CURRENCY_UNSUPPORTED");
  });

  it("returns a deterministic safe authorization DTO from a signed test event", () => {
    const event = {
      type: "mock.issuing_authorization.request",
      id: "evt_mock_123",
      authorization: {
        id: "iauth_mock_123",
        cardId: "mock_card_demo-agent",
        amountCents: 1250,
        currency: "HKD",
        merchantCategoryCode: "5734",
        merchantName: "Hermes Cafe",
      },
    };

    const safeEvent = mockRail.verifyAuthorizationWebhook(JSON.stringify(event), "mock-signature");
    expect(safeEvent).toEqual({
      eventId: "evt_mock_123",
      railAuthorizationId: "iauth_mock_123",
      railCardId: "mock_card_demo-agent",
      amountCents: 1250,
      currency: "HKD",
      merchantCategoryCode: "5734",
      merchantName: "Hermes Cafe",
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(safeEvent).not.toHaveProperty("authorization");
    expect(mockRail.parseAuthorizationRequest(safeEvent)).toEqual(safeEvent);
    expect(mockRail.verifyAuthorizationWebhook(JSON.stringify(event), "mock-signature")).toEqual(
      safeEvent,
    );

    expect(
      mockRail.verifyAuthorizationWebhook(
        JSON.stringify({ type: "mock.issuing_authorization.updated", id: "evt_other" }),
        "mock-signature",
      ),
    ).toBeNull();
  });

  it("rejects unsigned, oversized, or malformed test events", () => {
    expect(() => mockRail.verifyAuthorizationWebhook("{}", null)).toThrow(
      "PAYMENT_WEBHOOK_SIGNATURE_REQUIRED",
    );
    expect(() => mockRail.verifyAuthorizationWebhook("{}", "wrong")).toThrow(
      "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
    );
    expect(() =>
      mockRail.verifyAuthorizationWebhook("x".repeat(16 * 1024 + 1), "mock-signature"),
    ).toThrow("PAYMENT_WEBHOOK_TOO_LARGE");
  });

  it("returns only the approval bit for a direct decision", () => {
    expect(
      mockRail.directDecisionBody({
        authorizationId: randomUUID(),
        approved: true,
        reasonCode: "PAYMENT_ALLOWED",
        reason: "ok",
        mandateId: null,
        policyVersion: 1,
        decidedAt: new Date().toISOString(),
        latencyMs: 4,
      }),
    ).toEqual({ approved: true });
  });
});
