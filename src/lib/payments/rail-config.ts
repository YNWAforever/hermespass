import { z } from "zod";

export const paymentRailName = z.enum(["mock", "stripe", "airwallex", "nium"]);
export type ConfiguredPaymentRail = z.infer<typeof paymentRailName>;

export function configuredPaymentRail(): ConfiguredPaymentRail {
  return paymentRailName.parse(process.env["PAYMENT_RAIL"] ?? "stripe");
}

export function requireStripeTestKey(): string {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key || !key.startsWith("sk_test_")) {
    throw new Error("PAYMENT_RAIL_TEST_KEY_REQUIRED");
  }
  return key;
}

export function requireStripeIssuingWebhookSecret(): string {
  const secret = process.env["STRIPE_ISSUING_WEBHOOK_SECRET"];
  if (!secret) throw new Error("STRIPE_ISSUING_WEBHOOK_SECRET_REQUIRED");
  return secret;
}
