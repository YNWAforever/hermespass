import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";

import { gatewayActionSchema } from "@/lib/policy/action";
import type { GatewayActionV1 } from "@/lib/policy/action";
import type {
  PaymentDecisionFromPolicy,
  PaymentPolicyActionInput,
  PaymentPolicyResult,
} from "@/lib/payments/types";

export class PaymentPolicyInputError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "PaymentPolicyInputError";
    this.code = code;
  }
}

function derivePayloadDigest(input: PaymentPolicyActionInput): string {
  const payload = canonicalize({
    amountCents: input.amountCents,
    currency: input.currency,
    merchantCategoryCode: input.merchantCategoryCode ?? null,
    merchantName: input.merchantName ?? null,
  });
  if (payload === undefined) throw new PaymentPolicyInputError("PAYMENT_PAYLOAD_INVALID");
  return createHash("sha256").update(payload).digest("base64url");
}

export function toPaymentPolicyAction(input: PaymentPolicyActionInput): GatewayActionV1 {
  if (!input || typeof input !== "object") {
    throw new PaymentPolicyInputError("PAYMENT_ACTION_INVALID");
  }
  if (typeof input.keyId !== "string" || input.keyId.trim().length === 0) {
    throw new PaymentPolicyInputError("PAYMENT_KEY_ID_REQUIRED");
  }
  if (!z.string().uuid().safeParse(input.keyId).success) {
    throw new PaymentPolicyInputError("PAYMENT_KEY_ID_INVALID");
  }

  try {
    const merchantName = input.merchantName?.trim() || null;
    const summary =
      input.summary?.trim() ||
      (merchantName
        ? "External payment authorization for " + merchantName
        : "External payment authorization");
    const timestamp =
      input.timestamp instanceof Date ? input.timestamp.toISOString() : input.timestamp;

    return gatewayActionSchema.parse({
      version: "1",
      agentDid: input.agentDid,
      keyId: input.keyId,
      tool: "checkout.external",
      summary,
      justification: input.justification ?? null,
      payloadDigest: input.payloadDigest ?? derivePayloadDigest(input),
      amountCents: input.amountCents,
      currency: input.currency,
      merchantCategoryCode: input.merchantCategoryCode ?? null,
      nonce: input.nonce,
      timestamp,
    });
  } catch (error) {
    if (error instanceof PaymentPolicyInputError) throw error;
    throw new PaymentPolicyInputError("PAYMENT_ACTION_INVALID");
  }
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
