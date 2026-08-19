import type { AgentDto } from "@/lib/agents/types";

function fixtureAgent(input: {
  slug: string;
  name: string;
  role: string;
  risk: AgentDto["risk"];
  scopes: string[];
  spendCap: number;
  status?: AgentDto["status"];
}): AgentDto {
  const did = `did:web:hermespass.asia:agent:${input.slug}`;
  return {
    databaseId: `00000000-0000-4000-8000-${input.slug.length.toString().padStart(12, "0")}`,
    id: did,
    slug: input.slug,
    name: input.name,
    role: input.role,
    org: "HermesPass E2E",
    orgSlug: "hermespass-e2e",
    status: input.status ?? "active",
    risk: input.risk,
    scopes: input.scopes,
    spendCap: input.spendCap,
    issued: "2026-01-01",
    expires: "2027-01-01",
    keyStatus: "active",
    keyCustody: "external",
    thumbprint: `fixture-${input.slug}`,
    publicKey: null,
    credentialId: `urn:uuid:${input.slug}`,
    credentialJws: "",
    governanceNotes: null,
  };
}

export const E2E_AGENTS: AgentDto[] = [
  fixtureAgent({
    slug: "kinnso-recommendation",
    name: "Kinnso Recommendation Agent",
    role: "Retail personalisation",
    risk: "low",
    scopes: ["catalog.read", "crm.read", "email.dispatch"],
    spendCap: 0,
  }),
  fixtureAgent({
    slug: "fimmick-merchant-concierge",
    name: "Fimmick Merchant Concierge",
    role: "Merchant support & refunds",
    risk: "medium",
    scopes: ["crm.read", "refund.issue", "email.dispatch"],
    spendCap: 500,
  }),
  fixtureAgent({
    slug: "adfocate-campaign-optimizer",
    name: "Adfocate Campaign Optimizer",
    role: "Paid media buying",
    risk: "medium",
    scopes: ["ads.bid", "invoice.approve"],
    spendCap: 12000,
  }),
  fixtureAgent({
    slug: "autoprocure-bot",
    name: "AutoProcure Bot",
    role: "Financial actions & procurement",
    risk: "high",
    scopes: ["checkout.external", "invoice.approve", "vendor.contract"],
    spendCap: 45000,
    status: "revoked",
  }),
];
