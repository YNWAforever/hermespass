import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Blocks,
  Clock,
  Fingerprint,
  Gauge,
  ScrollText,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  CtaBand,
  Section,
  SectionHeading,
  SiteShell,
} from "@/components/marketing/site-shell";

export const Route = createFileRoute("/benefits")({
  head: () => ({
    meta: [
      { title: "Benefits — Why Enterprises Choose HermesPass for KYA" },
      {
        name: "description",
        content:
          "Ship agents faster with less risk: verifiable agent identity, real-time authority limits, scoped spend and regulator-ready evidence produced automatically.",
      },
      {
        property: "og:title",
        content: "Benefits of HermesPass — Know Your Agent Infrastructure",
      },
      {
        property: "og:description",
        content:
          "Four controls in one enforcement point, and what makes HermesPass different from IAM, API gateways and application logging.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BenefitsPage,
});

const BENEFITS = [
  {
    icon: Clock,
    title: "Approve agents in days, not quarters",
    body: "Risk sets thresholds once in the control plane. Product teams inherit them, so each new agent stops being a bespoke governance review.",
    proof: "One control plane, reused per agent",
  },
  {
    icon: Fingerprint,
    title: "Every action is attributable",
    body: "Agents authenticate with resolvable did:web identifiers and signed credentials instead of borrowed service accounts, so logs name the agent, not a system user.",
    proof: "W3C VC 2.0 + DID Core",
  },
  {
    icon: ShieldCheck,
    title: "Authority is bounded at runtime",
    body: "The gateway returns allow, hold or deny on every gated tool call, so an over-permissioned key can no longer become an incident.",
    proof: "Decision on 100% of gated calls",
  },
  {
    icon: Wallet,
    title: "Financial exposure is capped",
    body: "Scoped virtual cards with per-transaction, daily and monthly ceilings plus merchant whitelists turn spend risk into a configured number.",
    proof: "Caps enforced at authorisation",
  },
  {
    icon: ScrollText,
    title: "Audit evidence with no instrumentation",
    body: "The gateway writes a hash-linked record of each decision, so teams stop hand-building compliance logging per service and exports take one click.",
    proof: "Tamper-evident chain, CSV export",
  },
  {
    icon: Gauge,
    title: "Human oversight where it matters",
    body: "Holds route to named reviewers with the request, the policy reason and the agent's passport in one drawer, so oversight does not become a bottleneck.",
    proof: "Escalation to chat approval",
  },
] as const;

const DIFFERENTIATORS = [
  {
    label: "vs. IAM and secrets managers",
    body: "IAM issues a credential and stops. HermesPass evaluates each action against the agent's scope, risk tier and spend authority at the moment it happens.",
  },
  {
    label: "vs. API gateways",
    body: "An API gateway authenticates a caller. It has no concept of an agent identity, a delegated human mandate, or a spend ceiling that spans tools.",
  },
  {
    label: "vs. observability and logging",
    body: "Application logs are mutable and scattered. A hash-linked chain with signature validation is evidence a supervisor can rely on.",
  },
  {
    label: "vs. building it in-house",
    body: "Credential issuance, policy evaluation, card scoping and an append-only ledger are four systems. HermesPass ships them as one enforcement point.",
  },
] as const;

function BenefitsPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="Benefits"
          title="Move faster on agents because the controls already exist"
          description="HermesPass turns agent governance from a per-project debate into infrastructure: identity, authority, spend and evidence handled once, enforced everywhere."
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/use-cases"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
          >
            See it in a workflow
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-raised"
          >
            Explore the live demo
          </Link>
        </div>
      </Section>

      <Section>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body, proof }) => (
            <article key={title} className="panel flex flex-col p-6">
              <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
              <p className="mt-5 border-t border-border pt-4 font-mono text-[11px] text-cyan-accent">
                {proof}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section className="border-t border-border bg-sidebar/40">
        <SectionHeading
          eyebrow="Our uniqueness"
          title="Purpose-built for agents, not retrofitted from human IAM"
          description="Every adjacent category solves part of the problem. KYA is the layer that treats a non-human actor as a first-class, credentialed, spend-bounded identity."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {DIFFERENTIATORS.map((d) => (
            <div key={d.label} className="panel flex gap-4 p-6">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-accent/30 bg-cyan-accent/10 text-cyan-accent">
                <Blocks className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">{d.label}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {d.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="panel grid gap-6 p-8 sm:grid-cols-3">
          {[
            {
              stat: "4 controls",
              label: "Identity, authority, spend and evidence in one plane",
            },
            {
              stat: "2 regulators",
              label: "IMDA and HKMA frameworks mapped to platform features",
            },
            {
              stat: "1 enforcement point",
              label: "No per-service compliance instrumentation to maintain",
            },
          ].map((s) => (
            <div key={s.stat}>
              <p className="font-mono text-2xl font-semibold text-emerald-accent">
                {s.stat}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Put a number on your agent risk"
        description="Bring your agent inventory and spend authority. We will show which controls close the gap and what evidence you get."
      />
    </SiteShell>
  );
}
