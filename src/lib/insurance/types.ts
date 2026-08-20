export type InsuranceRiskTier = "low" | "medium" | "high";
export type InsuranceStatus = "quoted" | "binding" | "active" | "lapsed" | "canceled";
export type InsuranceEventKind =
  "quoted" | "bind_started" | "bound" | "lapsed" | "canceled" | "renewed";
export type InsurerName = "mock" | "aia" | "zurich";

export type InsuranceQuote = {
  insurer: "mock";
  insurerQuoteId: string;
  coverageCents: number;
  premiumCents: number;
  expiresAt: string;
};

export type BoundInsurancePolicy = {
  insurerPolicyId: string;
  boundAt: string;
  expiresAt: string;
};

export type InsuranceClock = {
  now(): Date;
};

export interface InsurerAdapter {
  readonly name: InsurerName;
  quote(input: {
    agentDid: string;
    riskTier: InsuranceRiskTier;
    idempotencyKey: string;
  }): Promise<InsuranceQuote>;
  bind(input: { quoteId: string; idempotencyKey: string }): Promise<BoundInsurancePolicy>;
}
