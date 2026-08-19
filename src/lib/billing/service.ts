import { createHash } from "node:crypto";

import Stripe from "stripe";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/lib/auth/authorization";
import { withActorTransaction } from "@/lib/auth/authorization";
import { PermissionDeniedError } from "@/lib/auth/errors";
import {
  stripeBillingPrice,
  stripeBillingSecret,
  stripeBillingWebhookSecret,
  issuerOrigin,
} from "@/lib/env";
import { withPublicDatabase, type Transaction } from "@/lib/db";

export const STRIPE_BILLING_API_VERSION = "2026-03-25.dahlia" as const;
export const BILLING_WEBHOOK_MAX_BYTES = 16 * 1024;
const billingTier = z.enum(["starter", "growth", "scale"]);
export type BillingTier = z.infer<typeof billingTier>;

function responseInvalid(): Error {
  return new Error("BILLING_PROVIDER_RESPONSE_INVALID");
}

export function stripeBillingClient(): Stripe {
  return new Stripe(stripeBillingSecret(), {
    apiVersion: STRIPE_BILLING_API_VERSION as Stripe.LatestApiVersion,
  });
}

export function tierForPrice(priceId: string): BillingTier | null {
  for (const tier of billingTier.options) {
    try {
      if (stripeBillingPrice(tier) === priceId) return tier;
    } catch {
      // Missing price configuration is handled by the request that needs it.
    }
  }
  return null;
}

export function billingReturnUrls(): { successUrl: string; cancelUrl: string } {
  const origin = issuerOrigin();
  return {
    successUrl: new URL("/dashboard?billing=success", origin).toString(),
    cancelUrl: new URL("/dashboard?billing=cancel", origin).toString(),
  };
}

function safeCustomerId(value: unknown): string | null {
  if (typeof value === "string" && /^cus_[A-Za-z0-9_]+$/.test(value) && value.length <= 255) {
    return value;
  }
  if (value && typeof value === "object" && "id" in value) {
    return safeCustomerId((value as { id?: unknown }).id);
  }
  return null;
}

function safeSubscriptionId(value: unknown): string | null {
  return typeof value === "string" && /^sub_[A-Za-z0-9_]+$/.test(value) && value.length <= 255
    ? value
    : null;
}

const subscriptionEventSchema = z
  .object({
    id: z.string().min(1).max(255),
    type: z.enum([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]),
    data: z.object({ object: z.unknown() }).strict(),
  })
  .passthrough();

function parseSubscriptionEvent(event: unknown): {
  id: string;
  type: z.infer<typeof subscriptionEventSchema>["type"];
  customerId: string;
  subscriptionId: string | null;
  tier: BillingTier | "pilot";
} | null {
  const parsed = subscriptionEventSchema.safeParse(event);
  if (!parsed.success) return null;
  const object = parsed.data.data.object;
  if (!object || typeof object !== "object") return null;
  const record = object as Record<string, unknown>;
  const customerId = safeCustomerId(record["customer"]);
  if (!customerId) return null;
  const subscriptionId = safeSubscriptionId(record["id"]);
  if (parsed.data.type !== "customer.subscription.deleted" && !subscriptionId) return null;
  if (parsed.data.type === "customer.subscription.deleted") {
    return {
      id: parsed.data.id,
      type: parsed.data.type,
      customerId,
      subscriptionId: null,
      tier: "pilot",
    };
  }
  const status = record["status"];
  if (status !== "active" && status !== "trialing") {
    return {
      id: parsed.data.id,
      type: parsed.data.type,
      customerId,
      subscriptionId,
      tier: "pilot",
    };
  }
  const items = record["items"];
  const first =
    items &&
    typeof items === "object" &&
    "data" in items &&
    Array.isArray((items as { data?: unknown }).data)
      ? (items as { data: unknown[] }).data[0]
      : null;
  const price =
    first && typeof first === "object" && "price" in first
      ? (first as { price?: unknown }).price
      : null;
  const priceId =
    price && typeof price === "object" && "id" in price ? (price as { id?: unknown }).id : null;
  if (typeof priceId !== "string") return null;
  const tier = tierForPrice(priceId);
  return tier
    ? { id: parsed.data.id, type: parsed.data.type, customerId, subscriptionId, tier }
    : null;
}

export async function ensureStripeCustomer(tx: Transaction, actor: Actor): Promise<string> {
  const result = await tx.execute(sql`
    select stripe_customer_id
    from public.organizations
    where id = ${actor.organizationId}::uuid
    for update
  `);
  const current = (result.rows[0] as { stripe_customer_id?: unknown } | undefined)
    ?.stripe_customer_id;
  if (typeof current === "string" && current.length > 0) return current;

  const customer = await stripeBillingClient().customers.create({
    name: actor.organizationName,
    ...(actor.email ? { email: actor.email } : {}),
    metadata: {
      organization_id: actor.organizationId,
      organization_slug: actor.organizationSlug,
    },
  });
  if (!customer.id || !/^cus_[A-Za-z0-9_]+$/.test(customer.id)) throw responseInvalid();
  await tx.execute(
    sql`select public.hermes_store_stripe_customer(${actor.organizationId}::uuid, ${customer.id})`,
  );
  return customer.id;
}

export async function createBillingCheckout(
  actor: Actor,
  tier: BillingTier,
): Promise<{ url: string }> {
  if (actor.role !== "owner") throw new PermissionDeniedError();
  const priceId = stripeBillingPrice(tier);
  const customerId = await withActorTransaction(actor, (tx) => ensureStripeCustomer(tx, actor));
  const urls = billingReturnUrls();
  const session = await stripeBillingClient().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    metadata: { organization_id: actor.organizationId, tier },
    subscription_data: { metadata: { organization_id: actor.organizationId, tier } },
  });
  if (!session.url || !/^https:\/\//.test(session.url)) throw responseInvalid();
  return { url: session.url };
}

export async function handleBillingEvent(
  rawBody: string,
  signature: string | null,
): Promise<{ received: true }> {
  if (!signature || Buffer.byteLength(rawBody, "utf8") > BILLING_WEBHOOK_MAX_BYTES) {
    throw new Error(!signature ? "BILLING_WEBHOOK_SIGNATURE_INVALID" : "PAYLOAD_TOO_LARGE");
  }
  let event: unknown;
  const client = stripeBillingClient();
  const webhookSecret = stripeBillingWebhookSecret();
  try {
    event = client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw new Error("BILLING_WEBHOOK_SIGNATURE_INVALID");
  }
  const parsed = parseSubscriptionEvent(event);
  if (!parsed) throw new Error("BILLING_WEBHOOK_EVENT_INVALID");
  const digest = createHash("sha256").update(rawBody, "utf8").digest();
  await withPublicDatabase((database) =>
    database.transaction(async (tx) => {
      await tx.execute(sql`select public.hermes_set_productization_claim('system:billing')`);
      await tx.execute(sql`
        select public.hermes_apply_billing_event(
          ${parsed.customerId}, ${parsed.id}, ${parsed.type}, ${parsed.subscriptionId},
          ${parsed.tier}, ${digest}
        )
      `);
    }),
  );
  return { received: true };
}

export { billingTier };
