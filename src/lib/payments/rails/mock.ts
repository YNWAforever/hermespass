import { z } from "zod";

import type { PaymentAuthorizationInput, PaymentDecision, PaymentRail, RailCard } from "./types";

const MOCK_SIGNATURE = "mock-signature";
const MAX_WEBHOOK_BYTES = 16 * 1_024;
const MOCK_RECEIVED_AT = Date.parse("2026-01-01T00:00:00.000Z");

const mockAuthorizationEventSchema = z
  .object({
    type: z.literal("mock.issuing_authorization.request"),
    id: z.string().min(1).max(255),
    authorization: z
      .object({
        id: z.string().min(1).max(255),
        cardId: z.string().min(1).max(255),
        amountCents: z.number().int().positive().safe(),
        currency: z.literal("HKD"),
        merchantCategoryCode: z
          .string()
          .regex(/^\d{4}$/)
          .nullable(),
        merchantName: z.string().trim().min(1).max(255).nullable(),
      })
      .strict(),
  })
  .strict();

const safeAuthorizationInputSchema = z
  .object({
    eventId: z.string().min(1).max(255),
    railAuthorizationId: z.string().min(1).max(255),
    railCardId: z.string().min(1).max(255),
    amountCents: z.number().int().positive().safe(),
    currency: z.literal("HKD"),
    merchantCategoryCode: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    merchantName: z.string().trim().min(1).max(255).nullable(),
    receivedAt: z.date(),
  })
  .strict();

type MockAuthorizationEvent = z.infer<typeof mockAuthorizationEventSchema>;

function paymentRailError(code: string): Error {
  return new Error(code);
}

function parseMockEvent(event: unknown): MockAuthorizationEvent | null {
  const parsed = mockAuthorizationEventSchema.safeParse(event);
  return parsed.success ? parsed.data : null;
}

function toPaymentAuthorizationInput(parsed: MockAuthorizationEvent): PaymentAuthorizationInput {
  return {
    eventId: parsed.id,
    railAuthorizationId: parsed.authorization.id,
    railCardId: parsed.authorization.cardId,
    amountCents: parsed.authorization.amountCents,
    currency: parsed.authorization.currency,
    merchantCategoryCode: parsed.authorization.merchantCategoryCode,
    merchantName: parsed.authorization.merchantName,
    receivedAt: new Date(MOCK_RECEIVED_AT),
  };
}

const cards = new Map<string, RailCard>();

export const mockRail: PaymentRail = {
  name: "mock",

  async ensureCardholder(input) {
    if (!input.idempotencyKey) throw paymentRailError("PAYMENT_RAIL_IDEMPOTENCY_REQUIRED");
    return `mock_cardholder_${input.organizationId}`;
  },

  async createVirtualCard(input) {
    if (input.currency !== "HKD") {
      throw paymentRailError("PAYMENT_RAIL_CURRENCY_UNSUPPORTED");
    }
    const card: RailCard = {
      railCardId: `mock_card_${input.agentSlug}`,
      cardholderId: input.cardholderId,
      last4: "4242",
      brand: "Visa",
      currency: "HKD",
      status: "active",
    };
    cards.set(card.railCardId, card);
    return { ...card };
  },

  async updateCardControls(input) {
    if (!cards.has(input.railCardId)) {
      throw paymentRailError("PAYMENT_RAIL_CARD_NOT_FOUND");
    }
  },

  async setCardStatus(input) {
    const card = cards.get(input.railCardId);
    if (!card) throw paymentRailError("PAYMENT_RAIL_CARD_NOT_FOUND");
    cards.set(input.railCardId, { ...card, status: input.status });
  },

  verifyAuthorizationWebhook(payload, signature) {
    if (!signature) throw paymentRailError("PAYMENT_WEBHOOK_SIGNATURE_REQUIRED");
    if (signature !== MOCK_SIGNATURE) {
      throw paymentRailError("PAYMENT_WEBHOOK_SIGNATURE_INVALID");
    }
    if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) {
      throw paymentRailError("PAYMENT_WEBHOOK_TOO_LARGE");
    }
    let event: unknown;
    try {
      event = JSON.parse(payload) as unknown;
    } catch {
      throw paymentRailError("PAYMENT_WEBHOOK_INVALID");
    }
    const parsed = parseMockEvent(event);
    if (!parsed) throw paymentRailError("PAYMENT_WEBHOOK_INVALID");
    return toPaymentAuthorizationInput(parsed);
  },

  parseAuthorizationRequest(event): PaymentAuthorizationInput | null {
    const safe = safeAuthorizationInputSchema.safeParse(event);
    if (safe.success) {
      return { ...safe.data, receivedAt: new Date(safe.data.receivedAt) };
    }
    const parsed = parseMockEvent(event);
    return parsed ? toPaymentAuthorizationInput(parsed) : null;
  },

  directDecisionBody(decision: PaymentDecision) {
    return { approved: decision.approved };
  },
};
