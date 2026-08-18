import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalGatewayActionBytes,
  gatewayActionSchema,
  gatewayRequestSchema,
  verifyGatewaySignature,
  type GatewayActionV1,
} from "@/lib/policy/action";
import { evaluateGatewayPolicy, type GatewayPolicyContext } from "@/lib/policy/engine";
import {
  ALLOW_AUTHORIZATION_MS,
  HOLD_EXPIRY_MS,
  MAX_ACTION_AGE_MS,
  gatewayTimeState,
} from "@/lib/policy/time";
import { generateEd25519KeyPair } from "@/lib/identity/keys";

const cryptoApi = globalThis.crypto ?? webcrypto;

const action: GatewayActionV1 = {
  version: "1",
  agentDid: "did:web:hermespass.test:agents:procurement-bot",
  keyId: "33333333-3333-4333-8333-333333333333",
  tool: "vendor.contract",
  summary: "Approve the signed vendor contract digest",
  justification: "Quarterly supplier renewal",
  payloadDigest: Buffer.alloc(32, 17).toString("base64url"),
  amountCents: 15_000,
  currency: "HKD",
  merchantCategoryCode: "7399",
  nonce: "66666666-6666-4666-8666-666666666666",
  timestamp: "2026-08-18T03:00:00.000Z",
};

const policyContext: GatewayPolicyContext = {
  now: new Date("2026-08-18T03:00:30.000Z"),
  passport: {
    active: true,
    expiresAt: new Date("2027-08-18T03:00:00.000Z"),
    scopes: ["vendor.contract"],
    spendCapCents: 100_000,
    risk: "low",
  },
  keyActive: true,
  policy: {
    version: 7,
    currency: "HKD",
    perTransactionLimitCents: 50_000,
    dailyLimitCents: 100_000,
    monthlyLimitCents: 500_000,
    approvalThresholdCents: 20_000,
    mccAllowlist: ["7399"],
    mccRequired: true,
    assignedReviewerUserId: "reviewer-1",
  },
  dailySpendCents: 20_000,
  monthlySpendCents: 100_000,
};

describe("signed gateway action", () => {
  it("uses RFC 8785 canonical bytes independent of input field order", () => {
    const reordered = Object.fromEntries(Object.entries(action).reverse());

    expect(canonicalGatewayActionBytes(reordered)).toEqual(canonicalGatewayActionBytes(action));
    expect(new TextDecoder().decode(canonicalGatewayActionBytes(action))).toBe(
      '{"agentDid":"did:web:hermespass.test:agents:procurement-bot","amountCents":15000,"currency":"HKD","justification":"Quarterly supplier renewal","keyId":"33333333-3333-4333-8333-333333333333","merchantCategoryCode":"7399","nonce":"66666666-6666-4666-8666-666666666666","payloadDigest":"ERERERERERERERERERERERERERERERERERERERERERE","summary":"Approve the signed vendor contract digest","timestamp":"2026-08-18T03:00:00.000Z","tool":"vendor.contract","version":"1"}',
    );
  });

  it("verifies Ed25519 over canonical action bytes and rejects tampering", async () => {
    const pair = await generateEd25519KeyPair();
    const privateKey = await cryptoApi.subtle.importKey(
      "jwk",
      pair.privateJwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const signature = Buffer.from(
      await cryptoApi.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        canonicalGatewayActionBytes(action),
      ),
    ).toString("base64url");

    await expect(verifyGatewaySignature(action, signature, pair.publicJwk)).resolves.toBe(true);
    const reordered = Object.fromEntries(Object.entries(action).reverse()) as GatewayActionV1;
    await expect(verifyGatewaySignature(reordered, signature, pair.publicJwk)).resolves.toBe(true);
    await expect(
      verifyGatewaySignature({ ...action, amountCents: 15_001 }, signature, pair.publicJwk),
    ).resolves.toBe(false);
  });

  it("accepts only the exact safe signed schema", () => {
    expect(gatewayRequestSchema.parse({ action, signature: "A".repeat(86) })).toEqual({
      action,
      signature: "A".repeat(86),
    });

    for (const invalid of [
      { ...action, version: "2" },
      { ...action, tool: "shell.exec" },
      { ...action, payloadDigest: "not-a-digest" },
      { ...action, amountCents: Number.MAX_SAFE_INTEGER + 1 },
      { ...action, amountCents: 1, currency: null },
      { ...action, amountCents: null, currency: "HKD" },
      { ...action, summary: " " },
      { ...action, rawParameters: { recipient: "secret@example.com" } },
    ]) {
      expect(() => gatewayActionSchema.parse(invalid)).toThrow();
    }
  });
});

describe("gateway policy first-match order", () => {
  it("denies invalid lifecycle before every later rule", () => {
    expect(
      evaluateGatewayPolicy(action, {
        ...policyContext,
        passport: { ...policyContext.passport, active: false, scopes: [] },
        keyActive: false,
        policy: null,
      }),
    ).toMatchObject({ decision: "deny", reasonCode: "PASSPORT_INACTIVE" });
  });

  it("allows in-scope non-spend before requiring a policy", () => {
    expect(
      evaluateGatewayPolicy(
        {
          ...action,
          tool: "catalog.read",
          amountCents: null,
          currency: null,
          merchantCategoryCode: null,
        },
        {
          ...policyContext,
          passport: { ...policyContext.passport, scopes: ["catalog.read"] },
          policy: null,
        },
      ),
    ).toMatchObject({ decision: "allow", reasonCode: "NON_SPEND_ALLOWED", policyVersion: null });
  });

  it("applies HKD, passport cap, MCC, limits, approval, and risk in exact order", () => {
    const decide = (overrides: Record<string, unknown>, context: GatewayPolicyContext) =>
      evaluateGatewayPolicy({ ...action, ...overrides } as GatewayActionV1, context);

    expect(
      decide({ currency: "USD", amountCents: 200_000, merchantCategoryCode: "9999" }, policyContext)
        .reasonCode,
    ).toBe("CURRENCY_NOT_SUPPORTED");
    expect(
      decide({ amountCents: 200_000, merchantCategoryCode: "9999" }, policyContext).reasonCode,
    ).toBe("PASSPORT_SPEND_CAP_EXCEEDED");
    expect(decide({ merchantCategoryCode: "9999" }, policyContext).reasonCode).toBe(
      "MCC_NOT_ALLOWED",
    );
    expect(
      decide(
        { amountCents: 60_000 },
        { ...policyContext, dailySpendCents: 90_000, monthlySpendCents: 490_000 },
      ).reasonCode,
    ).toBe("PER_TRANSACTION_LIMIT_EXCEEDED");
    expect(
      decide({ amountCents: 15_000 }, { ...policyContext, dailySpendCents: 90_000 }).reasonCode,
    ).toBe("DAILY_LIMIT_EXCEEDED");
    expect(
      decide({ amountCents: 15_000 }, { ...policyContext, monthlySpendCents: 490_000 }).reasonCode,
    ).toBe("MONTHLY_LIMIT_EXCEEDED");
    expect(decide({ amountCents: 25_000 }, policyContext)).toMatchObject({
      decision: "hold",
      reasonCode: "APPROVAL_REQUIRED",
    });
    expect(
      decide(
        { amountCents: 15_000 },
        { ...policyContext, passport: { ...policyContext.passport, risk: "high" } },
      ),
    ).toMatchObject({ decision: "hold", reasonCode: "HIGH_RISK_REVIEW_REQUIRED" });
    expect(decide({ amountCents: 15_000 }, policyContext)).toMatchObject({
      decision: "allow",
      reasonCode: "POLICY_ALLOWED",
      policyVersion: 7,
    });
  });
});

describe("gateway time semantics", () => {
  it("denies stale signed actions and creates exact allow/hold expiries", () => {
    const now = new Date("2026-08-18T03:05:00.000Z");

    expect(gatewayTimeState("2026-08-18T02:59:59.999Z", now)).toMatchObject({ fresh: false });
    expect(gatewayTimeState("2026-08-18T03:00:00.000Z", now)).toEqual({
      fresh: true,
      authorizationExpiresAt: new Date(now.getTime() + ALLOW_AUTHORIZATION_MS),
      holdExpiresAt: new Date(now.getTime() + HOLD_EXPIRY_MS),
    });
    expect(MAX_ACTION_AGE_MS).toBe(5 * 60 * 1000);
    expect(ALLOW_AUTHORIZATION_MS).toBe(5 * 60 * 1000);
    expect(HOLD_EXPIRY_MS).toBe(4 * 60 * 60 * 1000);
  });
});
