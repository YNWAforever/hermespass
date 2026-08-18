import { ed25519 } from "@noble/curves/ed25519.js";
import canonicalize from "canonicalize";
import { z } from "zod";

import type {
  MandateBodyV1,
  MandateConstraints,
  MandateMatchResult,
  MandateVerificationKey,
  PaymentCharge,
  SignedMandateV1,
} from "@/lib/payments/types";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const mandateConstraintsSchema = z
  .object({
    currency: z.literal("HKD"),
    maxAmountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    merchant: z.string().min(1).max(255).nullable(),
    mccAllowlist: z.array(z.string().regex(/^\d{4}$/)).max(100),
    expiresAt: z.string().datetime({ offset: true }),
    oneTime: z.boolean(),
  })
  .strict();

const mandateBodySchema = z
  .object({
    version: z.literal("1"),
    mandateId: z.string().uuid(),
    agentDid: z.string().regex(/^did:web:[^\s]+$/),
    keyId: z.string().uuid(),
    kind: z.enum(["intent", "cart"]),
    nonce: z.string().uuid(),
    issuedAt: z.string().datetime({ offset: true }),
    parentMandateId: z.string().uuid().nullable(),
    constraints: mandateConstraintsSchema,
  })
  .strict();

export class PaymentInputError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "PaymentInputError";
    this.code = code;
  }
}

function isCanonicalBase64Url(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return false;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === expectedBytes && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string, expectedBytes: number): Uint8Array {
  if (!isCanonicalBase64Url(value, expectedBytes)) {
    throw new PaymentInputError("MANDATE_SIGNATURE_INVALID");
  }
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

function publicKeyBytes(key: MandateVerificationKey): Uint8Array {
  const jwk = key.publicJwk as Record<string, unknown>;
  if (
    jwk["kty"] !== "OKP" ||
    jwk["crv"] !== "Ed25519" ||
    "d" in jwk ||
    !isCanonicalBase64Url(jwk["x"], 32)
  ) {
    throw new PaymentInputError("MANDATE_SIGNATURE_INVALID");
  }
  return Uint8Array.from(Buffer.from(jwk["x"] as string, "base64url"));
}

function parseBody(body: unknown): MandateBodyV1 {
  return mandateBodySchema.parse(body) as MandateBodyV1;
}

export function canonicalMandateBytes(body: MandateBodyV1): Uint8Array {
  let parsed: MandateBodyV1;
  try {
    parsed = parseBody(body);
  } catch {
    throw new PaymentInputError("MANDATE_NOT_CANONICAL");
  }
  const serialized = canonicalize(parsed);
  if (serialized === undefined) throw new PaymentInputError("MANDATE_NOT_CANONICAL");
  return new TextEncoder().encode(serialized);
}

export function verifyMandate(
  signed: SignedMandateV1,
  key: MandateVerificationKey,
  now: Date,
): { valid: true } | { valid: false; reasonCode: string } {
  if (key.custody !== "external" || key.status !== "active") {
    return { valid: false, reasonCode: "MANDATE_KEY_INACTIVE" };
  }

  let body: MandateBodyV1;
  try {
    if (!signed || typeof signed !== "object" || !("body" in signed)) {
      throw new PaymentInputError("MANDATE_SIGNATURE_INVALID");
    }
    body = parseBody((signed as { body: unknown }).body);
  } catch {
    return { valid: false, reasonCode: "MANDATE_SIGNATURE_INVALID" };
  }

  if (body.keyId !== key.id || body.agentDid !== key.agentDid) {
    return { valid: false, reasonCode: "MANDATE_KEY_MISMATCH" };
  }

  const issuedAt = Date.parse(body.issuedAt);
  const expiresAt = Date.parse(body.constraints.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now.getTime() ||
    expiresAt <= now.getTime()
  ) {
    return { valid: false, reasonCode: "MANDATE_EXPIRED" };
  }

  try {
    const signature = decodeBase64Url(signed.signature, 64);
    const publicKey = publicKeyBytes(key);
    if (!ed25519.verify(signature, canonicalMandateBytes(body), publicKey)) {
      return { valid: false, reasonCode: "MANDATE_SIGNATURE_INVALID" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reasonCode: "MANDATE_SIGNATURE_INVALID" };
  }
}

const MATCH_REASONS = {
  currency: "The payment rail currency is not supported by this mandate.",
  expired: "The mandate has expired for this charge.",
  amount: "The charge exceeds the mandate amount cap.",
  merchant: "The merchant does not match the mandate.",
  mcc: "The merchant category code is not allowed by the mandate.",
  consumed: "The one-time mandate has already been consumed.",
} as const;

export function mandateMatchesCharge(
  constraints: MandateConstraints,
  charge: PaymentCharge,
): MandateMatchResult {
  if (charge.currency !== "HKD" || constraints.currency !== "HKD") {
    return {
      matches: false,
      reasonCode: "RAIL_CURRENCY_UNSUPPORTED",
      reason: MATCH_REASONS.currency,
    };
  }
  const chargeAt = charge.at ?? charge.receivedAt;
  const expiresAt = Date.parse(constraints.expiresAt);
  if (
    !(chargeAt instanceof Date) ||
    !Number.isFinite(chargeAt.getTime()) ||
    !Number.isFinite(expiresAt)
  ) {
    return { matches: false, reasonCode: "MANDATE_EXPIRED", reason: MATCH_REASONS.expired };
  }
  if (chargeAt.getTime() >= expiresAt) {
    return { matches: false, reasonCode: "MANDATE_EXPIRED", reason: MATCH_REASONS.expired };
  }
  if (constraints.oneTime && (charge.alreadyConsumed || charge.consumed)) {
    return {
      matches: false,
      reasonCode: "MANDATE_ALREADY_CONSUMED",
      reason: MATCH_REASONS.consumed,
    };
  }
  if (
    !Number.isSafeInteger(charge.amountCents) ||
    charge.amountCents <= 0 ||
    charge.amountCents > constraints.maxAmountCents
  ) {
    return {
      matches: false,
      reasonCode: "MANDATE_AMOUNT_EXCEEDED",
      reason: MATCH_REASONS.amount,
    };
  }
  if (
    constraints.merchant !== null &&
    charge.merchantName !== null &&
    charge.merchantName !== undefined &&
    charge.merchantName !== constraints.merchant
  ) {
    return {
      matches: false,
      reasonCode: "MANDATE_MERCHANT_MISMATCH",
      reason: MATCH_REASONS.merchant,
    };
  }
  if (
    constraints.mccAllowlist.length > 0 &&
    (charge.merchantCategoryCode === null ||
      charge.merchantCategoryCode === undefined ||
      !constraints.mccAllowlist.includes(charge.merchantCategoryCode))
  ) {
    return {
      matches: false,
      reasonCode: "MANDATE_MCC_MISMATCH",
      reason: MATCH_REASONS.mcc,
    };
  }
  return { matches: true };
}
