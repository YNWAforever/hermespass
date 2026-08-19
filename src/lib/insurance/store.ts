import { sql } from "drizzle-orm";

import type { Transaction } from "@/lib/db";
import type { InsuranceRiskTier, InsuranceStatus } from "./types";

export type InsuranceAgentContext = {
  organizationId: string;
  agentId: string;
  did: string;
  riskTier: InsuranceRiskTier;
  status: "active" | "revoked";
  expiresAt: string;
};

export type InsurancePolicyDto = {
  id: string;
  agentId: string;
  version: number;
  insurer: "mock";
  riskTier: InsuranceRiskTier;
  status: InsuranceStatus;
  coverageCents: number;
  premiumCents: number;
  commissionBps: number;
  insurerQuoteId: string | null;
  insurerPolicyId: string | null;
  quotedAt: string;
  boundAt: string | null;
  expiresAt: string | null;
};

type Row = Record<string, unknown>;
const value = (row: Row, key: string): unknown => row[key];

function safeNumber(input: unknown, label: string): number {
  const number = typeof input === "bigint" ? Number(input) : Number(input);
  if (!Number.isSafeInteger(number))
    throw new Error(`INSURANCE_${label.toUpperCase()}_OUT_OF_RANGE`);
  return number;
}

function optionalIso(input: unknown): string | null {
  return input === null || input === undefined ? null : new Date(String(input)).toISOString();
}

export function mapInsurancePolicy(row: Row): InsurancePolicyDto {
  return {
    id: String(value(row, "id")),
    agentId: String(value(row, "agent_id") ?? value(row, "agentId")),
    version: safeNumber(value(row, "version"), "version"),
    insurer: String(value(row, "insurer")) as "mock",
    riskTier: String(
      value(row, "risk") ?? value(row, "risk_tier") ?? value(row, "riskTier"),
    ) as InsuranceRiskTier,
    status: String(value(row, "status")) as InsuranceStatus,
    coverageCents: safeNumber(
      value(row, "coverage_cents") ?? value(row, "coverageCents"),
      "coverage",
    ),
    premiumCents: safeNumber(value(row, "premium_cents") ?? value(row, "premiumCents"), "premium"),
    commissionBps: safeNumber(
      value(row, "commission_bps") ?? value(row, "commissionBps"),
      "commission",
    ),
    insurerQuoteId: (value(row, "insurer_quote_id") ?? value(row, "insurerQuoteId") ?? null) as
      string | null,
    insurerPolicyId: (value(row, "insurer_policy_id") ?? value(row, "insurerPolicyId") ?? null) as
      string | null,
    quotedAt: new Date(String(value(row, "quoted_at") ?? value(row, "quotedAt"))).toISOString(),
    boundAt: optionalIso(value(row, "bound_at") ?? value(row, "boundAt")),
    expiresAt: optionalIso(value(row, "expires_at") ?? value(row, "expiresAt")),
  };
}

export async function getInsuranceAgentContext(
  tx: Transaction,
  agentId: string,
): Promise<InsuranceAgentContext | null> {
  const result = await tx.execute(
    sql`SELECT * FROM public.hermes_insurance_agent_context(${agentId}::uuid)`,
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  return {
    organizationId: String(value(row, "organization_id")),
    agentId: String(value(row, "agent_id")),
    did: String(value(row, "did")),
    riskTier: String(value(row, "risk")) as InsuranceRiskTier,
    status: String(value(row, "status")) as InsuranceAgentContext["status"],
    expiresAt: new Date(String(value(row, "expires_at"))).toISOString(),
  };
}

export async function listInsurancePolicies(
  tx: Transaction,
  organizationId: string,
  cursor: Date | null,
  limit: number,
): Promise<InsurancePolicyDto[]> {
  const result = await tx.execute(
    sql`SELECT * FROM public.hermes_insurance_policy_list(${organizationId}::uuid, ${cursor}, ${limit})`,
  );
  return result.rows.map((row) => mapInsurancePolicy(row as Row));
}

export async function insertInsuranceQuote(
  tx: Transaction,
  input: {
    organizationId: string;
    agentId: string;
    insurerQuoteId: string;
    coverageCents: number;
    premiumCents: number;
    quotedAt: string;
    expiresAt: string;
  },
): Promise<InsurancePolicyDto> {
  const result = await tx.execute(
    sql`SELECT * FROM public.hermes_insurance_quote_insert(${JSON.stringify(input)}::jsonb)`,
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new Error("INSURANCE_QUOTE_INSERT_FAILED");
  return mapInsurancePolicy(row);
}
