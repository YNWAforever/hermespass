import { createHash, webcrypto } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";

export const GATEWAY_TOOLS = [
  "catalog.read",
  "crm.read",
  "refund.issue",
  "email.dispatch",
  "checkout.external",
  "invoice.approve",
  "ads.bid",
  "vendor.contract",
] as const;

const cryptoApi = globalThis.crypto ?? webcrypto;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function isCanonicalBase64Url(value: string, bytes: number): boolean {
  if (!BASE64URL_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === value;
}

const gatewayActionBaseSchema = z
  .object({
    version: z.literal("1"),
    agentDid: z
      .string()
      .min(1)
      .max(512)
      .regex(/^did:[a-z0-9]+:.+/),
    keyId: z.string().uuid(),
    tool: z.enum(GATEWAY_TOOLS),
    summary: z
      .string()
      .max(280)
      .refine((value) => value.trim().length > 0, "Summary cannot be blank"),
    justification: z.string().max(1_000).nullable(),
    payloadDigest: z.string().refine((value) => isCanonicalBase64Url(value, 32)),
    amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    currency: z.literal("HKD").nullable(),
    merchantCategoryCode: z
      .string()
      .regex(/^[0-9]{4}$/)
      .nullable(),
    nonce: z.string().uuid(),
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();

export const gatewayActionSchema = gatewayActionBaseSchema.superRefine((action, context) => {
  if (action.amountCents === null) {
    if (action.currency !== null || action.merchantCategoryCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: "Non-spend actions cannot include spend metadata",
      });
    }
    return;
  }

  if (action.currency === null) {
    context.addIssue({
      code: "custom",
      path: ["currency"],
      message: "Spend actions require a currency",
    });
  }
});

export const gatewayRequestSchema = z
  .object({
    action: gatewayActionSchema,
    signature: z.string().refine((value) => isCanonicalBase64Url(value, 64)),
  })
  .strict();

export type GatewayActionV1 = z.infer<typeof gatewayActionSchema>;
export type SignedGatewayRequest = z.infer<typeof gatewayRequestSchema>;

export type PublicEd25519Jwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
};

function parsePublicEd25519Jwk(value: unknown): PublicEd25519Jwk | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record["kty"] !== "OKP" ||
    record["crv"] !== "Ed25519" ||
    typeof record["x"] !== "string" ||
    !isCanonicalBase64Url(record["x"], 32) ||
    "d" in record
  ) {
    return null;
  }
  return { kty: "OKP", crv: "Ed25519", x: record["x"] };
}

export function canonicalGatewayActionBytes(value: unknown): ArrayBuffer {
  const action = gatewayActionSchema.parse(value);
  const serialized = canonicalize(action);
  if (!serialized) throw new Error("GATEWAY_ACTION_INVALID");
  return new TextEncoder().encode(serialized).buffer as ArrayBuffer;
}

export async function verifyGatewaySignature(
  action: GatewayActionV1,
  signature: string,
  publicJwk: unknown,
): Promise<boolean> {
  try {
    if (!isCanonicalBase64Url(signature, 64)) return false;
    const publicKeyJwk = parsePublicEd25519Jwk(publicJwk);
    if (!publicKeyJwk) return false;
    const publicKey = await cryptoApi.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return cryptoApi.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      Uint8Array.from(Buffer.from(signature, "base64url")).buffer,
      canonicalGatewayActionBytes(action),
    );
  } catch {
    return false;
  }
}

export function gatewayRequestDigests(request: SignedGatewayRequest): {
  requestDigest: Buffer;
  payloadDigest: Buffer;
  signatureDigest: Buffer;
} {
  const actionBytes = canonicalGatewayActionBytes(request.action);
  return {
    requestDigest: createHash("sha256").update(new Uint8Array(actionBytes)).digest(),
    payloadDigest: Buffer.from(request.action.payloadDigest, "base64url"),
    signatureDigest: createHash("sha256")
      .update(Buffer.from(request.signature, "base64url"))
      .digest(),
  };
}
