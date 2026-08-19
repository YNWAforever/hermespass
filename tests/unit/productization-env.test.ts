import { afterEach, beforeEach, describe, expect, it } from "vitest";

const names = [
  "REPORT_EXPORT_SECRET",
  "STRIPE_BILLING_WEBHOOK_SECRET",
  "COMMS_INBOUND_SECRET",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_GROWTH",
  "STRIPE_PRICE_SCALE",
] as const;

const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of names) delete process.env[name];
});

afterEach(() => {
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Phase 5 request-time environment configuration", () => {
  it("imports without reading optional provider configuration", async () => {
    const env = await import("@/lib/env");
    expect(env).toHaveProperty("reportExportSecret");
    expect(env).toHaveProperty("stripeBillingWebhookSecret");
    expect(env).toHaveProperty("commsInboundSecret");
    expect(env).toHaveProperty("stripeBillingPrice");
  });

  it.each([
    ["reportExportSecret", "REPORT_EXPORT_SECRET is required for report exports"],
    [
      "stripeBillingWebhookSecret",
      "STRIPE_BILLING_WEBHOOK_SECRET is required for billing webhooks",
    ],
    ["commsInboundSecret", "COMMS_INBOUND_SECRET is required for inbound communications"],
  ] as const)("fails closed for %s when missing", async (name, message) => {
    const env = await import("@/lib/env");
    expect(() => env[name]()).toThrow(message);
  });

  it.each(["starter", "growth", "scale"] as const)(
    "returns the configured %s Stripe price",
    async (tier) => {
      process.env[`STRIPE_PRICE_${tier.toUpperCase()}`] = `price_${tier}`;
      const { stripeBillingPrice } = await import("@/lib/env");
      expect(stripeBillingPrice(tier)).toBe(`price_${tier}`);
    },
  );

  it("rejects a partial Stripe price configuration", async () => {
    process.env.STRIPE_PRICE_STARTER = "price_starter";
    const { stripeBillingPrice } = await import("@/lib/env");
    expect(() => stripeBillingPrice("growth")).toThrow("STRIPE_PRICE_GROWTH is required");
  });
});
