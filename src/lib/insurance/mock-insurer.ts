import { coverageForRiskTier, premiumForRiskTier } from "./rates";
import type {
  BoundInsurancePolicy,
  InsuranceClock,
  InsurerAdapter,
  InsuranceQuote,
  InsuranceRiskTier,
} from "./types";

const SYSTEM_CLOCK: InsuranceClock = { now: () => new Date() };

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function isoAfter(date: Date, days: number): string {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString();
}

export class MockInsurer implements InsurerAdapter {
  readonly name = "mock" as const;
  private readonly clock: InsuranceClock;

  constructor(clock: InsuranceClock = SYSTEM_CLOCK) {
    this.clock = clock;
  }

  async quote(input: {
    agentDid: string;
    riskTier: InsuranceRiskTier;
    idempotencyKey: string;
  }): Promise<InsuranceQuote> {
    if (!input.agentDid.trim() || !input.idempotencyKey.trim()) {
      throw new Error("Mock quote requires an agent DID and idempotency key");
    }
    return {
      insurer: "mock",
      insurerQuoteId: `mockq_${encode(`${input.agentDid}:${input.riskTier}`)}`,
      coverageCents: coverageForRiskTier(input.riskTier),
      premiumCents: premiumForRiskTier(input.riskTier),
      expiresAt: isoAfter(this.clock.now(), 7),
    };
  }

  async bind(input: { quoteId: string; idempotencyKey: string }): Promise<BoundInsurancePolicy> {
    if (!input.quoteId.startsWith("mockq_"))
      throw new Error("Mock insurer accepts only mock quotes");
    if (!input.idempotencyKey.trim()) throw new Error("Mock bind requires an idempotency key");
    const now = this.clock.now();
    return {
      insurerPolicyId: `mockp_${encode(`${input.quoteId}:${input.idempotencyKey}`)}`,
      boundAt: now.toISOString(),
      expiresAt: isoAfter(now, 365),
    };
  }
}
