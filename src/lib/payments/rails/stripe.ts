import "server-only";

import Stripe from "stripe";
import { z } from "zod";

import {
  requireStripeIssuingWebhookSecret,
  requireStripeTestKey,
} from "@/lib/payments/rail-config";

import type { PaymentAuthorizationInput, PaymentDecision, PaymentRail, RailCard } from "./types";

export const STRIPE_API_VERSION = "2026-03-25.dahlia" as const;
const MAX_WEBHOOK_BYTES = 16 * 1_024;

function stripeClient(): Stripe {
  return new Stripe(requireStripeTestKey(), {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });
}

function responseError(): Error {
  return new Error("PAYMENT_RAIL_RESPONSE_INVALID");
}

function safeMetadata(input: {
  organizationId?: string;
  agentSlug?: string;
  policyVersion?: number;
}): Record<string, string> {
  return {
    ...(input.organizationId ? { organization_id: input.organizationId } : {}),
    ...(input.agentSlug ? { agent_slug: input.agentSlug } : {}),
    ...(input.policyVersion !== undefined ? { policy_version: String(input.policyVersion) } : {}),
  };
}

const stripeEventSchema = z
  .object({
    id: z.string().min(1).max(255),
    type: z.literal("issuing_authorization.request"),
    data: z.object({ object: z.unknown() }).strict(),
  })
  .passthrough();

const authorizationObjectSchema = z
  .object({
    id: z.string().min(1).max(255),
    card: z.union([z.string().min(1).max(255), z.object({ id: z.string().min(1).max(255) })]),
    amount: z.number().int().positive().safe(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    merchant_data: z
      .object({
        category_code: z
          .string()
          .regex(/^\d{4}$/)
          .nullable()
          .optional(),
        name: z.string().trim().min(1).max(255).nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const safeAuthorizationInputSchema = z
  .object({
    eventId: z.string().min(1).max(255),
    railAuthorizationId: z.string().min(1).max(255),
    railCardId: z.string().min(1).max(255),
    amountCents: z.number().int().positive().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    merchantCategoryCode: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    merchantName: z.string().trim().min(1).max(255).nullable(),
    receivedAt: z.date(),
  })
  .strict();

function parsedAuthorization(event: unknown): {
  eventId: string;
  authorization: z.infer<typeof authorizationObjectSchema>;
} | null {
  const eventResult = stripeEventSchema.safeParse(event);
  if (!eventResult.success) return null;
  const authorizationResult = authorizationObjectSchema.safeParse(eventResult.data.data.object);
  if (!authorizationResult.success) return null;
  return { eventId: eventResult.data.id, authorization: authorizationResult.data };
}

function toPaymentAuthorizationInput(parsed: {
  eventId: string;
  authorization: z.infer<typeof authorizationObjectSchema>;
}): PaymentAuthorizationInput {
  const card =
    typeof parsed.authorization.card === "string"
      ? parsed.authorization.card
      : parsed.authorization.card.id;
  const merchantData = parsed.authorization.merchant_data;
  return {
    eventId: parsed.eventId,
    railAuthorizationId: parsed.authorization.id,
    railCardId: card,
    amountCents: parsed.authorization.amount,
    currency: parsed.authorization.currency.toUpperCase(),
    merchantCategoryCode: merchantData?.category_code ?? null,
    merchantName: merchantData?.name ?? null,
    receivedAt: new Date(),
  };
}

function parseSafeAuthorizationInput(event: unknown): PaymentAuthorizationInput | null {
  const safe = safeAuthorizationInputSchema.safeParse(event);
  return safe.success ? { ...safe.data, receivedAt: new Date(safe.data.receivedAt) } : null;
}

export function createStripePaymentRail(): PaymentRail {
  return {
    name: "stripe",

    async ensureCardholder(input) {
      const stripe = stripeClient();
      const cardholder = await stripe.issuing.cardholders.create({
        name: input.organizationName,
        type: "company",
        billing: { address: { country: "HK" } },
        metadata: safeMetadata({ organizationId: input.organizationId }),
      } as Stripe.Issuing.CardholderCreateParams);
      if (!cardholder.id) throw responseError();
      return cardholder.id;
    },

    async createVirtualCard(input) {
      const stripe = stripeClient();
      const card = await stripe.issuing.cards.create({
        cardholder: input.cardholderId,
        currency: input.currency.toLowerCase(),
        type: "virtual",
        metadata: safeMetadata({ agentSlug: input.agentSlug, policyVersion: input.policyVersion }),
      } as Stripe.Issuing.CardCreateParams);
      const last4 = typeof card.last4 === "string" ? card.last4 : "";
      if (!card.id || !/^\d{4}$/.test(last4)) throw responseError();
      const brand =
        typeof card.brand === "string" && card.brand.length <= 32 ? card.brand : "unknown";
      const currency = typeof card.currency === "string" ? card.currency.toUpperCase() : "";
      if (!currency) throw responseError();
      const status = card.status === "active" ? "active" : "inactive";
      return {
        railCardId: card.id,
        cardholderId: input.cardholderId,
        last4,
        brand,
        currency,
        status,
      } satisfies RailCard;
    },

    async updateCardControls(input) {
      const stripe = stripeClient();
      await stripe.issuing.cards.update(input.railCardId, {
        metadata: safeMetadata({ policyVersion: input.policyVersion }),
      });
    },

    async setCardStatus(input) {
      const stripe = stripeClient();
      await stripe.issuing.cards.update(input.railCardId, {
        status: input.status,
      } as Stripe.Issuing.CardUpdateParams);
    },

    verifyAuthorizationWebhook(payload, signature) {
      if (!signature) throw new Error("PAYMENT_WEBHOOK_SIGNATURE_REQUIRED");
      if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) {
        throw new Error("PAYMENT_WEBHOOK_TOO_LARGE");
      }
      const webhookSecret = requireStripeIssuingWebhookSecret();
      try {
        const event = stripeClient().webhooks.constructEvent(payload, signature, webhookSecret);
        const parsed = parsedAuthorization(event);
        return parsed ? toPaymentAuthorizationInput(parsed) : null;
      } catch {
        throw new Error("PAYMENT_WEBHOOK_SIGNATURE_INVALID");
      }
    },

    parseAuthorizationRequest(event): PaymentAuthorizationInput | null {
      const safe = parseSafeAuthorizationInput(event);
      if (safe) return safe;
      const parsed = parsedAuthorization(event);
      return parsed ? toPaymentAuthorizationInput(parsed) : null;
    },

    directDecisionBody(decision: PaymentDecision) {
      return { approved: decision.approved };
    },
  };
}
