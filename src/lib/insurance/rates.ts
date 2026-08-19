import type { InsuranceRiskTier } from "./types";

const RATE_CARD = {
  low: { premiumCents: 8_000, coverageCents: 50_000_000 },
  medium: { premiumCents: 25_000, coverageCents: 200_000_000 },
  high: { premiumCents: 90_000, coverageCents: 500_000_000 },
} as const satisfies Record<InsuranceRiskTier, { premiumCents: number; coverageCents: number }>;

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

function cardFor(tier: InsuranceRiskTier) {
  const card = RATE_CARD[tier];
  if (!card) throw new Error("Unsupported insurance risk tier");
  return card;
}

export function premiumForRiskTier(tier: InsuranceRiskTier): number {
  return cardFor(tier).premiumCents;
}

export function coverageForRiskTier(tier: InsuranceRiskTier): number {
  return cardFor(tier).coverageCents;
}

export function commissionCents(premiumCents: number, commissionBps = 2_000): number {
  if (!Number.isSafeInteger(premiumCents) || premiumCents <= 0) {
    throw new Error("Insurance premium must be a positive safe integer");
  }
  if (!Number.isSafeInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new Error("Insurance commission basis points are invalid");
  }
  const result = (BigInt(premiumCents) * BigInt(commissionBps)) / 10_000n;
  const value = Number(result);
  if (!Number.isSafeInteger(value))
    throw new Error("Insurance commission exceeds safe integer range");
  return value;
}
