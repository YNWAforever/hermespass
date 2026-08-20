import { createHash, randomUUID } from "node:crypto";

import canonicalize from "canonicalize";
import { z } from "zod";

import {
  evaluateGatewayPolicy,
  type GatewayPolicy,
  type GatewayPolicyContext,
} from "@/lib/policy/engine";
import { toPaymentPolicyAction } from "@/lib/payments/policy-adapter";
import { mandateMatchesCharge } from "@/lib/payments/mandates";
import type { MandateConstraints } from "@/lib/payments/types";
import type { PaymentAuthorizationInput } from "@/lib/payments/rails/types";

export type PaymentDecision = {
  authorizationId: string;
  approved: boolean;
  reasonCode: string;
  reason: string;
  mandateId: string | null;
  policyVersion: number | null;
  decidedAt: string;
  latencyMs: number;
};

export type PaymentCardContext = {
  walletCardId: string;
  organizationId: string;
  agentId: string;
  rail: string;
  railCardId: string;
  currency: string;
  cardStatus: "provisioning" | "active" | "frozen" | "canceled";
  agentDid: string;
  agentStatus: "active" | "revoked";
  passportExpiresAt: Date;
  scopes: string[];
  spendCapCents: number;
  risk: "low" | "medium" | "high";
  keyId: string;
  keyActive: boolean;
};

export type PaymentMandateContext = MandateConstraints & {
  id: string;
  agentId: string;
  organizationId: string;
  status: "active" | "consumed" | "revoked" | "expired";
};

export type StoredPaymentDecision = PaymentDecision & {
  fingerprint: string;
};

export type PaymentAuditInput = {
  organizationId: string;
  agentId: string;
  action: "payment.authorization" | "payment.authorization_reversed";
  decision: "allow" | "deny";
  amountCents: number;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export interface PaymentAuthorizationTransactionPort {
  databaseTime(): Promise<Date>;
  lookupCard(rail: string, railCardId: string): Promise<PaymentCardContext | null>;
  lockAgent(agentId: string): Promise<void>;
  findReplay(
    rail: string,
    eventId: string,
    railAuthorizationId: string,
  ): Promise<StoredPaymentDecision | null>;
  lookupMandate(
    context: PaymentCardContext,
    mandateId: string | null,
  ): Promise<PaymentMandateContext | null>;
  getActivePolicy(agentId: string, organizationId: string): Promise<GatewayPolicy | null>;
  getSpendTotals(
    agentId: string,
    organizationId: string,
    now: Date,
  ): Promise<{ dailySpendCents: number; monthlySpendCents: number }>;
  consumeMandate(
    mandateId: string,
    agentId: string,
    organizationId: string,
    now: Date,
  ): Promise<boolean>;
  insertAuthorization(input: PaymentAuthorizationInsert): Promise<StoredPaymentDecision>;
  appendAudit(input: PaymentAuditInput): Promise<void>;
}

export interface PaymentAuthorizationStore {
  transaction?<T>(
    callback: (transaction: PaymentAuthorizationTransactionPort) => Promise<T>,
  ): Promise<T>;
  /** Compatibility seam for deterministic unit fixtures. */
  authorize?(input: PaymentAuthorizationInput): Promise<PaymentDecision>;
}

export type PaymentAuthorizationInsert = {
  organizationId: string;
  agentId: string;
  walletCardId: string;
  railCardId: string;
  rail: string;
  eventId: string;
  railAuthorizationId: string;
  amountCents: number;
  currency: string;
  merchantCategoryCode: string | null;
  merchantName: string | null;
  mandateId: string | null;
  decision: "allow" | "deny";
  status: "approved" | "declined";
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
  latencyMs: number;
  receivedAt: Date;
  decidedAt: Date;
};

export class PaymentAuthorizationError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "PaymentAuthorizationError";
  }
}

const inputSchema = z.object({
  eventId: z.string().trim().min(1).max(255),
  rail: z.string().trim().min(1).max(50).default("mock"),
  railAuthorizationId: z.string().trim().min(1).max(255),
  railCardId: z.string().trim().min(1).max(255),
  mandateId: z.string().uuid().nullable().optional(),
  amountCents: z.number().int().positive().safe(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  merchantCategoryCode: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  merchantName: z.string().trim().min(1).max(255).nullable(),
  receivedAt: z.date(),
});

export function paymentDecision(
  reasonCode: string,
  reason: string,
  approved = false,
  mandateId: string | null = null,
  policyVersion: number | null = null,
  authorizationId = randomUUID(),
): PaymentDecision {
  return {
    authorizationId,
    approved,
    reasonCode,
    reason,
    mandateId,
    policyVersion,
    decidedAt: new Date().toISOString(),
    latencyMs: 0,
  };
}

function fingerprint(input: PaymentAuthorizationInput): string {
  return JSON.stringify({
    rail: input.rail ?? "mock",
    eventId: input.eventId,
    railAuthorizationId: input.railAuthorizationId,
    railCardId: input.railCardId,
    mandateId: input.mandateId ?? null,
    amountCents: input.amountCents,
    currency: input.currency.toUpperCase(),
    merchantCategoryCode: input.merchantCategoryCode,
    merchantName: input.merchantName,
  });
}

function replayOrConflict(
  stored: StoredPaymentDecision,
  input: PaymentAuthorizationInput,
): PaymentDecision {
  if (stored.fingerprint !== fingerprint(input)) {
    throw new PaymentAuthorizationError("PAYMENT_EVENT_CONFLICT");
  }
  return stored;
}

function paymentPayloadDigest(input: PaymentAuthorizationInput): string {
  const payload = canonicalize({
    amountCents: input.amountCents,
    currency: input.currency.toUpperCase(),
    merchantCategoryCode: input.merchantCategoryCode,
    merchantName: input.merchantName,
  });
  if (payload === undefined) throw new PaymentAuthorizationError("PAYMENT_INPUT_INVALID");
  return createHash("sha256").update(payload).digest("base64url");
}
function paymentNonce(input: PaymentAuthorizationInput): string {
  const hex = createHash("sha256")
    .update(`${input.rail ?? "mock"}:${input.railAuthorizationId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function reasonFor(code: string): string {
  const reasons: Record<string, string> = {
    CARD_NOT_FOUND: "The payment card was not found.",
    CARD_INACTIVE: "The payment card is not active.",
    AGENT_INACTIVE: "The agent passport is inactive or expired.",
    MANDATE_REQUIRED: "A matching payment mandate is required.",
    RAIL_CURRENCY_UNSUPPORTED: "The payment rail supports HKD only.",
    MANDATE_AMOUNT_EXCEEDED: "The payment exceeds the mandate amount.",
    MANDATE_EXPIRED: "The payment mandate has expired.",
    MANDATE_ALREADY_CONSUMED: "The one-time mandate has already been consumed.",
    PAYMENT_REQUIRES_PREAUTHORIZATION: "This payment requires preauthorization.",
  };
  return reasons[code] ?? "The payment was declined.";
}

async function authorizeInTransaction(
  input: PaymentAuthorizationInput,
  transaction: PaymentAuthorizationTransactionPort,
): Promise<PaymentDecision> {
  const started = await transaction.databaseTime();
  const rail = input.rail ?? "mock";
  let card = await transaction.lookupCard(rail, input.railCardId);
  if (!card) return paymentDecision("CARD_NOT_FOUND", reasonFor("CARD_NOT_FOUND"));

  await transaction.lockAgent(card.agentId);
  card = (await transaction.lookupCard(rail, input.railCardId)) ?? card;
  const replay = await transaction.findReplay(rail, input.eventId, input.railAuthorizationId);
  if (replay) return replayOrConflict(replay, input);

  let reasonCode: string | null = null;
  let reason = "";
  let approved = false;
  let mandateId: string | null = input.mandateId ?? null;
  let policyVersion: number | null = null;
  const policyPayloadDigest = paymentPayloadDigest(input);

  if (card.cardStatus !== "active") reasonCode = "CARD_INACTIVE";
  else if (card.agentStatus !== "active" || card.passportExpiresAt.getTime() <= started.getTime())
    reasonCode = "AGENT_INACTIVE";
  else if (card.currency.toUpperCase() !== "HKD" || input.currency.toUpperCase() !== "HKD")
    reasonCode = "RAIL_CURRENCY_UNSUPPORTED";

  const mandate = reasonCode
    ? null
    : await transaction.lookupMandate(card, input.mandateId ?? null);
  if (!reasonCode && !mandate) reasonCode = "MANDATE_REQUIRED";
  if (!reasonCode && mandate) {
    mandateId = mandate.id;
    const match = mandateMatchesCharge(mandate, {
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      merchantCategoryCode: input.merchantCategoryCode,
      merchantName: input.merchantName,
      receivedAt: started,
      alreadyConsumed: mandate.status !== "active",
    });
    if (!match.matches) reasonCode = match.reasonCode;
  }

  let policyResult: ReturnType<typeof evaluateGatewayPolicy> | null = null;
  if (!reasonCode) {
    const policy = await transaction.getActivePolicy(card.agentId, card.organizationId);
    const spend = await transaction.getSpendTotals(card.agentId, card.organizationId, started);
    const action = toPaymentPolicyAction({
      agentDid: card.agentDid,
      keyId: card.keyId,
      amountCents: input.amountCents,
      currency: "HKD",
      merchantCategoryCode: input.merchantCategoryCode,
      merchantName: input.merchantName,
      nonce: paymentNonce(input),
      timestamp: started,
    });
    const context: GatewayPolicyContext = {
      now: started,
      passport: {
        active: card.agentStatus === "active",
        expiresAt: card.passportExpiresAt,
        scopes: card.scopes,
        spendCapCents: card.spendCapCents,
        risk: card.risk,
      },
      keyActive: card.keyActive,
      policy,
      ...spend,
    };
    policyResult = evaluateGatewayPolicy(action, context);
    policyVersion = policyResult.policyVersion;
    if (policyResult.decision === "allow") {
      approved = true;
      reasonCode = "PAYMENT_ALLOWED";
    } else if (policyResult.decision === "hold") {
      reasonCode = "PAYMENT_REQUIRES_PREAUTHORIZATION";
    } else {
      reasonCode = policyResult.reasonCode;
    }
    reason = policyResult.reason;
  }

  if (!reason) reason = reasonFor(reasonCode ?? "PAYMENT_DECLINED");
  const decidedAt = await transaction.databaseTime();
  const latencyMs = Math.max(0, decidedAt.getTime() - started.getTime());
  const stored = await transaction.insertAuthorization({
    organizationId: card.organizationId,
    agentId: card.agentId,
    walletCardId: card.walletCardId,
    railCardId: input.railCardId,
    rail,
    eventId: input.eventId,
    railAuthorizationId: input.railAuthorizationId,
    amountCents: input.amountCents,
    currency: input.currency.toUpperCase(),
    merchantCategoryCode: input.merchantCategoryCode,
    merchantName: input.merchantName,
    mandateId,
    decision: approved ? "allow" : "deny",
    status: approved ? "approved" : "declined",
    reasonCode,
    reason,
    policyVersion,
    latencyMs,
    receivedAt: started,
    decidedAt,
  });
  if (approved && mandate?.oneTime) {
    const consumed = await transaction.consumeMandate(
      mandate.id,
      card.agentId,
      card.organizationId,
      decidedAt,
    );
    if (!consumed) throw new PaymentAuthorizationError("MANDATE_ALREADY_CONSUMED");
  }
  await transaction.appendAudit({
    organizationId: card.organizationId,
    agentId: card.agentId,
    action: "payment.authorization",
    decision: approved ? "allow" : "deny",
    amountCents: input.amountCents,
    payload: {
      authorizationId: stored.authorizationId,
      payloadDigest: policyPayloadDigest,
      eventId: input.eventId,
      railAuthorizationId: input.railAuthorizationId,
      mandateId,
      merchantCategoryCode: input.merchantCategoryCode,
      policyVersion,
      reasonCode,
      latencyMs,
    },
    occurredAt: decidedAt,
  });
  return stored;
}

export async function authorizePayment(
  input: PaymentAuthorizationInput,
  store: PaymentAuthorizationStore,
): Promise<PaymentDecision> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new PaymentAuthorizationError("PAYMENT_INPUT_INVALID");
  const normalized = {
    ...parsed.data,
    rail: parsed.data.rail ?? "mock",
    currency: parsed.data.currency.toUpperCase(),
    mandateId: parsed.data.mandateId ?? null,
  };
  if (store.transaction)
    return store.transaction((transaction) => authorizeInTransaction(normalized, transaction));
  if (store.authorize) return store.authorize(normalized);
  throw new PaymentAuthorizationError("PAYMENT_UNAVAILABLE");
}
