import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { policyDto, policyInputSchema } from "@/lib/policies/types";

const validPolicy = {
  currency: "HKD" as const,
  perTransactionLimitCents: 50_000,
  dailyLimitCents: 100_000,
  monthlyLimitCents: 500_000,
  approvalThresholdCents: 20_000,
  mccAllowlist: ["5411", "5732"],
  mccRequired: true,
  assignedReviewerUserId: "reviewer-1",
};

describe("agent policy validation", () => {
  it("accepts only ordered JS-safe HKD cents and eligible MCC syntax", () => {
    expect(policyInputSchema.parse(validPolicy)).toEqual(validPolicy);
  });

  it.each([
    { ...validPolicy, currency: "USD" },
    { ...validPolicy, perTransactionLimitCents: -1 },
    { ...validPolicy, dailyLimitCents: 49_999 },
    { ...validPolicy, monthlyLimitCents: 99_999 },
    { ...validPolicy, approvalThresholdCents: 50_001 },
    { ...validPolicy, monthlyLimitCents: Number.MAX_SAFE_INTEGER + 1 },
    { ...validPolicy, dailyLimitCents: 100_000.5 },
    { ...validPolicy, mccAllowlist: ["541"] },
    { ...validPolicy, mccAllowlist: ["54A1"] },
    { ...validPolicy, mccAllowlist: [], mccRequired: true },
  ])("rejects an invalid policy: %o", (input) => {
    expect(() => policyInputSchema.parse(input)).toThrow();
  });

  it("maps only safe immutable policy fields", () => {
    const result = policyDto({
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: "22222222-2222-4222-8222-222222222222",
      agentId: "11111111-1111-4111-8111-111111111111",
      version: 2,
      ...validPolicy,
      isActive: true,
      supersededAt: null,
      createdByUserId: "admin-1",
      createdAt: new Date("2026-08-18T01:00:00.000Z"),
    });

    expect(result).toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      agentId: "11111111-1111-4111-8111-111111111111",
      version: 2,
      ...validPolicy,
      isActive: true,
      supersededAt: null,
      createdAt: "2026-08-18T01:00:00.000Z",
    });
    expect(result).not.toHaveProperty("organizationId");
    expect(result).not.toHaveProperty("createdByUserId");
  });

  it("does not generate, encrypt, or insert an agent private key during passport issuance", () => {
    const service = readFileSync(resolve(process.cwd(), "src/lib/agents/service.ts"), "utf8");

    expect(service).not.toContain("generateEd25519KeyPair");
    expect(service).not.toContain("encryptPrivateJwk");
    expect(service).not.toContain("tx.insert(agentKeys)");
  });
});
