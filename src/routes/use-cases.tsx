import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CreditCard,
  Database,
  FileSearch,
  Headphones,
  Mail,
  ShoppingBag,
} from "lucide-react";
import {
  CtaBand,
  Section,
  SectionHeading,
  SiteShell,
} from "@/components/marketing/site-shell";

export const Route = createFileRoute("/use-cases")({
  head: () => ({
    meta: [
      { title: "Use Cases — Governed AI Agent Workflows | HermesPass" },
      {
        name: "description",
        content:
          "Six production agent use cases governed end to end: autonomous purchasing, payment mandates, customer data access, claims triage, outbound comms and campaign budgets.",
      },
      {
        property: "og:title",
        content: "HermesPass Use Cases — Governed AI Agent Workflows",
      },
      {
        property: "og:description",
        content:
          "See exactly how a passport, a policy decision, a scoped wallet and a hash-linked audit record apply to each real agent workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UseCasesPage,
});

const USE_CASES = [
  {
    icon: ShoppingBag,
    title: "Autonomous purchasing",
    agent: "AutoProcure Bot",
    before:
      "An agent raises purchase orders using a shared service account. Nobody can prove which agent bought what, or who authorised it.",
    flow: [
      "Passport asserts the agent may call purchase_order.create up to HKD 50,000",
      "Gateway allows requests inside scope, holds anything above the threshold",
      "Approver signs off from the review drawer; the mandate is recorded",
      "Order, decision and approver are written into the audit chain",
    ],
  },
  {
    icon: CreditCard,
    title: "Agent-initiated payments",
    agent: "Merchant concierge",
    before:
      "Agents transact with a corporate card that carries the company's full credit limit and no merchant restrictions.",
    flow: [
      "Each agent gets a virtual card bound to its DID",
      "Per-transaction, daily and monthly ceilings are enforced at authorisation",
      "Merchant-category whitelists reject out-of-policy vendors",
      "Blocked spend is reported as evidence, not lost in card statements",
    ],
  },
  {
    icon: Database,
    title: "Customer data access",
    agent: "Support and CRM agents",
    before:
      "An API key grants an agent everything the key can read, including records far outside the task it was asked to do.",
    flow: [
      "Scopes bind the agent to named tools and record classes",
      "Bulk export attempts are held for human release",
      "Every read is attributable to one agent identity",
      "Access evidence maps to your data-protection obligations",
    ],
  },
  {
    icon: FileSearch,
    title: "Claims and application triage",
    agent: "Underwriting assistants",
    before:
      "Model-driven decisions land in production with no record of the authority under which they were made.",
    flow: [
      "Risk tier on the passport sets what the agent may decide alone",
      "Value and sensitivity thresholds escalate to a named reviewer",
      "Reason codes from policy are stored with each decision",
      "Supervisors receive a complete, tamper-evident file",
    ],
  },
  {
    icon: Mail,
    title: "Outbound customer communication",
    agent: "Lifecycle and sales agents",
    before:
      "Agents send messages at machine speed with no ceiling on volume or audience, and no reviewable trail.",
    flow: [
      "Send tools are scoped per segment and per channel",
      "Volume spikes trigger a hold instead of a send",
      "Escalation routes to a human via chat approval",
      "Sent content hashes are chained for later inspection",
    ],
  },
  {
    icon: Headphones,
    title: "Campaign and budget optimisation",
    agent: "Adfocate Campaign Optimizer",
    before:
      "Optimisation agents reallocate client budgets continuously, and reconstruction after an incident is guesswork.",
    flow: [
      "Client-scoped permissions prevent cross-account changes",
      "Reallocations above a percentage threshold require review",
      "Every bid and budget change is logged against the passport",
      "Per-client activity exports in one click",
    ],
  },
] as const;

function UseCasesPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="Use cases"
          title="Where agent autonomy meets real consequences"
          description="These are the workflows enterprises are automating today. Each one becomes governable the moment the agent carries an identity, a bounded authority and an evidence trail."
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/dashboard/approvals"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
          >
            Watch decisions live <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/industries"
            className="inline-flex items-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-raised"
          >
            By industry
          </Link>
        </div>
      </Section>

      <Section>
        <div className="grid gap-5 lg:grid-cols-2">
          {USE_CASES.map(({ icon: Icon, title, agent, before, flow }) => (
            <article key={title} className="panel flex flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-lg border border-cyan-accent/30 bg-cyan-accent/10 text-cyan-accent">
                  <Icon className="size-5" />
                </span>
                <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                  {agent}
                </span>
              </div>
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-3 text-xs tracking-wide text-risk-high uppercase">
                Today
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {before}
              </p>
              <p className="mt-4 text-xs tracking-wide text-emerald-accent uppercase">
                With HermesPass
              </p>
              <ol className="mt-2 space-y-2.5 border-t border-border pt-4">
                {flow.map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border border-border font-mono text-[10px] text-emerald-accent">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Start with one workflow"
        description="Pick the agent workflow that worries your risk function most. We will model its scopes, thresholds and evidence in a single session."
      />
    </SiteShell>
  );
}
