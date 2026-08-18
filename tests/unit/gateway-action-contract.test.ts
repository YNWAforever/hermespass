import { describe, expect, it } from "vitest";

import { gatewayActionSchema, gatewayRequestSchema } from "@/lib/policy/action";

const validAction = {
  version: "1",
  agentDid: "did:web:hermespass.test:agents:contract-bot",
  keyId: "33333333-3333-4333-8333-333333333333",
  tool: "vendor.contract",
  summary: "Approve a signed vendor contract digest",
  justification: "Quarterly supplier renewal",
  payloadDigest: Buffer.alloc(32, 17).toString("base64url"),
  amountCents: 1,
  currency: "HKD",
  merchantCategoryCode: "7399",
  nonce: "66666666-6666-4666-8666-666666666666",
  timestamp: "2026-08-18T03:00:00.000Z",
} as const;

describe("GatewayActionV1 exact signed contract", () => {
  it("enforces the exact summary and justification bounds", () => {
    expect(
      gatewayActionSchema.safeParse({ ...validAction, summary: "s".repeat(280) }).success,
    ).toBe(true);
    expect(
      gatewayActionSchema.safeParse({ ...validAction, summary: "s".repeat(281) }).success,
    ).toBe(false);
    expect(
      gatewayActionSchema.safeParse({ ...validAction, justification: "j".repeat(1_000) }).success,
    ).toBe(true);
    expect(
      gatewayActionSchema.safeParse({ ...validAction, justification: "j".repeat(1_001) }).success,
    ).toBe(false);
  });

  it("accepts only positive safe-integer spend amounts", () => {
    expect(gatewayActionSchema.safeParse(validAction).success).toBe(true);
    for (const amountCents of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(gatewayActionSchema.safeParse({ ...validAction, amountCents }).success).toBe(false);
    }
  });

  it("accepts only UUID nonces, HKD or null currency, and ISO-8601 timestamps", () => {
    expect(
      gatewayActionSchema.safeParse({
        ...validAction,
        amountCents: null,
        currency: null,
        merchantCategoryCode: null,
      }).success,
    ).toBe(true);
    expect(gatewayActionSchema.safeParse({ ...validAction, nonce: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(gatewayActionSchema.safeParse({ ...validAction, currency: "USD" }).success).toBe(false);
    expect(
      gatewayActionSchema.safeParse({ ...validAction, timestamp: "2026-08-18 03:00:00" }).success,
    ).toBe(false);
  });

  it("accepts only canonical unpadded base64url digests and signatures", () => {
    const signature = Buffer.alloc(64, 31).toString("base64url");
    expect(gatewayRequestSchema.safeParse({ action: validAction, signature }).success).toBe(true);

    for (const payloadDigest of [
      `${validAction.payloadDigest}=`,
      validAction.payloadDigest.replace(/.$/, "+"),
      Buffer.alloc(31, 17).toString("base64url"),
    ]) {
      expect(gatewayActionSchema.safeParse({ ...validAction, payloadDigest }).success).toBe(false);
    }

    for (const invalidSignature of [
      `${signature}=`,
      signature.replace(/.$/, "/"),
      Buffer.alloc(63, 31).toString("base64url"),
    ]) {
      expect(
        gatewayRequestSchema.safeParse({ action: validAction, signature: invalidSignature })
          .success,
      ).toBe(false);
    }
  });
});
