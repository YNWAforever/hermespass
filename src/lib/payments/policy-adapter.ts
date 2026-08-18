import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

import type { GatewayActionV1 } from "@/lib/policy/action";
import type {
  PaymentDecisionFromPolicy,
  PaymentPolicyActionInput,
  PaymentPolicyResult,
} from "@/lib/payments/types";

const FALLBACK_PAYMENT_KEY_ID = "00000000-0000-4000-8000-000000000000";

function derivePayloadDigest(input: PaymentPolicyActionInput): string {
  const payload = canonicalize({
    amountCents: input.amountCents,
    currency: input.currency,
    merchantCategoryCode: input.merchantCategoryCode ?? null,
    merchantName: input.merchantName ?? null,
  });
  if (payload === undefined) throw new Error("PAYMENT_PAYLOAD_INVALID");
  return createHash("sha256").update(payload).digest("base64url");
}

export function toPaymentPolicyAction(input: PaymentPolicyActionInput): GatewayActionV1 {
  const merchantName = input.merchantName?.trim() || null;
  const summary =
    input.summary?.trim() ||
    (merchantName
      ? `External payment authorization for ${merchantName}`
      : "External payment authorization");
  const timestamp =
    input.timestamp instanceof Date ? input.timestamp.toISOString() : input.timestamp;

  return {
    version: "1",
    agentDid: input.agentDid,
    keyId: input.keyId ?? FALLBACK_PAYMENT_KEY_ID,
    tool: "checkout.external",
    summary,
    justification: input.justification ?? null,
    payloadDigest: input.payloadDigest ?? derivePayloadDigest(input),
    amountCents: input.amountCents,
    currency: input.currency,
    merchantCategoryCode: input.merchantCategoryCode ?? null,
    nonce: input.nonce,
    timestamp,
  } as GatewayActionV1;
}

export function paymentDecisionFromPolicy(
  decision: PaymentPolicyResult,
): PaymentDecisionFromPolicy {
  if (decision.decision === "allow") {
    return {
      approved: true,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
    };
  }
  if (decision.decision === "deny") {
    return {
      approved: false,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
    };
  }
  return {
    approved: false,
    reasonCode: "PAYMENT_REQUIRES_PREAUTHORIZATION",
    reason: decision.reason,
    policyVersion: decision.policyVersion,
  };
}
