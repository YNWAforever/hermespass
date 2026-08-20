import { describe, expect, it } from "vitest";

import { commissionCents, coverageForRiskTier, premiumForRiskTier } from "@/lib/insurance/rates";
import { MockInsurer } from "@/lib/insurance/mock-insurer";
import { canTransition } from "@/lib/insurance/transitions";

describe("insurance rate card", () => {
  it("uses the fixed risk-tier prices and coverage", () => {
    expect(premiumForRiskTier("low")).toBe(8_000);
    expect(coverageForRiskTier("low")).toBe(50_000_000);
    expect(premiumForRiskTier("medium")).toBe(25_000);
    expect(coverageForRiskTier("medium")).toBe(200_000_000);
    expect(premiumForRiskTier("high")).toBe(90_000);
    expect(coverageForRiskTier("high")).toBe(500_000_000);
  });

  it("floors the fixed 20 percent commission with safe integer arithmetic", () => {
    expect(commissionCents(8_001)).toBe(1_600);
    expect(commissionCents(25_000)).toBe(5_000);
    expect(() => commissionCents(0)).toThrow(/positive/i);
    expect(() => commissionCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe/i);
  });
});

describe("insurance transitions", () => {
  it.each([
    ["quoted", "binding"],
    ["binding", "active"],
    ["active", "active"],
    ["active", "lapsed"],
    ["active", "canceled"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["lapsed", "active"],
    ["canceled", "quoted"],
    ["quoted", "active"],
    ["binding", "canceled"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("deterministic mock insurer", () => {
  const clock = { now: () => new Date("2026-08-20T00:00:00.000Z") };

  it("returns the fixed quote and seven-day expiry", async () => {
    const insurer = new MockInsurer(clock);
    const quote = await insurer.quote({
      agentDid: "did:web:hermespass.asia:agent:demo",
      riskTier: "medium",
      idempotencyKey: "quote-1",
    });
    expect(quote).toEqual({
      insurerQuoteId: expect.stringMatching(/^mockq_[A-Za-z0-9_-]+$/),
      insurer: "mock",
      coverageCents: 200_000_000,
      premiumCents: 25_000,
      expiresAt: "2026-08-27T00:00:00.000Z",
    });
    const repeat = await insurer.quote({
      agentDid: "did:web:hermespass.asia:agent:demo",
      riskTier: "medium",
      idempotencyKey: "quote-1",
    });
    expect(repeat).toEqual(quote);
  });

  it("binds only mock quotes and gives a one-year expiry", async () => {
    const insurer = new MockInsurer(clock);
    await expect(insurer.bind({ quoteId: "aia-q-1", idempotencyKey: "bind-1" })).rejects.toThrow(
      /mock quote/i,
    );
    const bound = await insurer.bind({ quoteId: "mockq_demo", idempotencyKey: "bind-1" });
    expect(bound).toEqual({
      insurerPolicyId: expect.stringMatching(/^mockp_[A-Za-z0-9_-]+$/),
      boundAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2027-08-20T00:00:00.000Z",
    });
    expect(await insurer.bind({ quoteId: "mockq_demo", idempotencyKey: "bind-1" })).toEqual(bound);
  });
});
