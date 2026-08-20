import type { Metadata } from "next";
import { Banknote, Bot, Megaphone, ShoppingCart } from "lucide-react";
import { CtaBand, Section, SectionHeading, SiteShell } from "@/components/marketing/site-shell";

export const metadata: Metadata = {
  title: "Solutions — Agent Governance by Industry | HermesPass",
  description:
    "How HermesPass removes agent risk for banks and insurers, commerce platforms, ad-tech agencies and procurement or BPO operations.",
  openGraph: {
    title: "HermesPass Solutions — Agent Governance by Industry",
    description:
      "Industry-specific agent controls: mandates for financial services, merchant-scoped purchasing, budget caps for ad-tech, and approval thresholds for procurement.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};
const SEGMENTS = [
  {
    icon: Banknote,
    title: "Banking & insurance",
    risk: "Agents drafting quotes, triaging claims or moving funds without a recorded mandate or a defensible audit trail.",
    outcome:
      "Every agent action carries a verifiable passport and a policy decision; high-impact steps require a named human mandate captured in the audit chain.",
    controls: [
      "Risk-tiered scopes per agent",
      "Mandatory human hold above value thresholds",
      "Immutable evidence for internal audit and supervisors",
    ],
  },
  {
    icon: ShoppingCart,
    title: "Commerce & marketplace platforms",
    risk: "Shopping and restocking agents transacting with a shared corporate card across unvetted merchants.",
    outcome:
      "Agents transact on scoped virtual cards with merchant-category whitelists and hard per-transaction ceilings.",
    controls: [
      "Merchant-category whitelists",
      "Per-agent daily and monthly caps",
      "Live utilisation and blocked-spend reporting",
    ],
  },
  {
    icon: Megaphone,
    title: "Ad tech & agencies",
    risk: "Optimisation agents adjusting budgets and bids at machine speed across client accounts.",
    outcome:
      "Budget authority is bounded per agent and per client, with holds on large reallocations and a per-client action log.",
    controls: [
      "Client-scoped tool permissions",
      "Budget-change thresholds with review",
      "Exportable per-client activity evidence",
    ],
  },
  {
    icon: Bot,
    title: "Procurement, BPO & back office",
    risk: "Autonomous purchasing and vendor-onboarding agents acting outside approval matrices.",
    outcome:
      "Approval thresholds mirror your delegation of authority, and each approval or rejection is recorded against the agent's passport.",
    controls: [
      "Threshold-based escalation to approvers",
      "Scope revocation and audit-hold states",
      "Chain-of-custody for every purchase decision",
    ],
  },
] as const;

export default function SolutionsPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="Solutions"
          title="Agent autonomy your risk function can sign off on"
          description="The same four controls — passports, gateway, wallets, audit chain — configured for the way your industry delegates authority."
        />
      </Section>

      <Section>
        <div className="grid gap-5 lg:grid-cols-2">
          {SEGMENTS.map(({ icon: Icon, title, risk, outcome, controls }) => (
            <article key={title} className="panel flex flex-col p-6">
              <span className="grid size-10 place-items-center rounded-lg border border-cyan-accent/30 bg-cyan-accent/10 text-cyan-accent">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-3 text-xs tracking-wide text-risk-high uppercase">Risk removed</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{risk}</p>
              <p className="mt-4 text-xs tracking-wide text-emerald-accent uppercase">Outcome</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{outcome}</p>
              <ul className="mt-5 space-y-2 border-t border-border pt-4">
                {controls.map((c) => (
                  <li key={c} className="flex gap-2.5 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-cyan-accent" />
                    <span className="text-muted-foreground">{c}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section className="border-t border-border bg-sidebar/40">
        <SectionHeading
          eyebrow="For platform teams"
          title="Governance that doesn't slow your agent roadmap"
          description="HermesPass is an enforcement point, not a rewrite. Your teams keep shipping agents while identity, limits and evidence are handled centrally."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Runtime agnostic",
              body: "Works with your own orchestration or an MCP-based tool server — passports travel with the request.",
            },
            {
              title: "Central policy, local speed",
              body: "Risk sets thresholds once; product teams inherit them without per-team review cycles.",
            },
            {
              title: "Audit without instrumentation",
              body: "Evidence is produced by the gateway, so teams don't hand-build compliance logging per service.",
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
        title="Bring your highest-risk agent"
        description="We'll map its tool scopes, spend authority and approval thresholds onto HermesPass controls in one session."
      />
    </SiteShell>
  );
}
