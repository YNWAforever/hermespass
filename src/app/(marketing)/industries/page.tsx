import type { Metadata } from "next";
import Link from "next/link";
import {
  Building2,
  HeartPulse,
  Landmark,
  Megaphone,
  Plane,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { CtaBand, Section, SectionHeading, SiteShell } from "@/components/marketing/site-shell";

export const metadata: Metadata = {
  title: "Industries — Agent Governance for Regulated Sectors",
  description:
    "HermesPass agent governance for financial services, insurance, commerce, ad tech, logistics, healthcare and professional services across Hong Kong and Singapore.",
  openGraph: {
    title: "HermesPass Industries — Agent Governance by Sector",
    description:
      "Sector-specific passports, thresholds, spend scopes and audit evidence built for the way each industry delegates authority.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};
const INDUSTRIES = [
  {
    icon: Landmark,
    name: "Banking & capital markets",
    pressure: "HKMA supervisory expectations, model and outsourcing risk",
    focus:
      "Named human mandates on value-bearing actions, risk-tiered scopes, and an evidence file a supervisor can read without your engineers present.",
    metrics: ["Mandate coverage", "Held-action turnaround", "Blocked spend"],
  },
  {
    icon: HeartPulse,
    name: "Insurance",
    pressure: "Fair-outcome scrutiny on automated decisions",
    focus:
      "Reason codes stored with every triage or quoting decision, escalation thresholds by value and sensitivity, and revocation the moment a model changes.",
    metrics: ["Decisions with reason codes", "Escalation rate", "Revocations"],
  },
  {
    icon: ShoppingCart,
    name: "Commerce & marketplaces",
    pressure: "Card-not-present fraud and unvetted merchants",
    focus:
      "Virtual cards bound to an agent DID, merchant-category whitelists, and hard per-transaction ceilings enforced at authorisation.",
    metrics: ["Out-of-policy attempts", "Cap utilisation", "Merchant coverage"],
  },
  {
    icon: Megaphone,
    name: "Ad tech & agencies",
    pressure: "Client funds moved autonomously at machine speed",
    focus:
      "Client-scoped tool permissions, review thresholds on budget reallocation, and per-client activity exports for account reviews.",
    metrics: ["Budget changes reviewed", "Cross-account blocks", "Export SLA"],
  },
  {
    icon: Truck,
    name: "Logistics & procurement",
    pressure: "Delegation-of-authority matrices and vendor onboarding",
    focus:
      "Approval thresholds that mirror your DOA, chain-of-custody per purchase, and audit-hold states for agents under investigation.",
    metrics: ["DOA alignment", "PO evidence completeness", "Hold volume"],
  },
  {
    icon: Building2,
    name: "Professional & business services",
    pressure: "Client confidentiality across shared agent tooling",
    focus:
      "Engagement-scoped data access, held bulk exports, and attributable reads that stand up in a client audit.",
    metrics: ["Scope violations", "Held exports", "Attributable reads"],
  },
  {
    icon: Plane,
    name: "Travel & hospitality",
    pressure: "High-volume booking and refund automation",
    focus:
      "Spend caps per itinerary class, refund thresholds routed to humans, and complete records for chargeback defence.",
    metrics: ["Refunds held", "Cap breaches prevented", "Dispute evidence"],
  },
] as const;

export default function IndustriesPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="Industries"
          title="Built for the sectors where an agent's mistake is a regulatory event"
          description="HermesPass is deployed as one control plane, configured per sector: the same passports, gateway, wallets and audit chain, tuned to how your industry delegates authority."
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/use-cases"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
          >
            See the workflows
          </Link>
          <Link
            href="/compliance-standards"
            className="inline-flex items-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-raised"
          >
            Compliance posture
          </Link>
        </div>
      </Section>

      <Section>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {INDUSTRIES.map(({ icon: Icon, name, pressure, focus, metrics }) => (
            <article key={name} className="panel flex flex-col p-6">
              <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{name}</h2>
              <p className="mt-2 font-mono text-[11px] tracking-wide text-risk-medium">
                {pressure}
              </p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{focus}</p>
              <ul className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
                {metrics.map((m) => (
                  <li
                    key={m}
                    className="rounded-full border border-border bg-surface-raised px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    {m}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section className="border-t border-border bg-sidebar/40">
        <SectionHeading
          eyebrow="Regional fit"
          title="Hong Kong and Singapore first"
          description="We built HermesPass against the two frameworks Asian enterprises are actually being measured on, then generalised outward."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              title: "HKMA GenA.I. Sandbox",
              body: "Control evidence structured for sandbox submissions and supervisory follow-up questions.",
            },
            {
              title: "IMDA Model AI Governance for GenAI",
              body: "Traceability, human oversight and incident reporting mapped to platform features, not policy documents.",
            },
            {
              title: "Cross-entity operations",
              body: "Separate org contexts for HK and SG entities, with per-entity passports, caps and exports.",
            },
          ].map((c) => (
            <div key={c.title} className="panel p-6">
              <h3 className="text-base font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Map HermesPass to your sector"
        description="Tell us the regulator, the entity structure and the agents in production. We will come back with a control map."
      />
    </SiteShell>
  );
}
