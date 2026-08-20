import type { Metadata } from "next";
import { Compass, Globe2, Target } from "lucide-react";
import { CtaBand, Section, SectionHeading, SiteShell } from "@/components/marketing/site-shell";

export const metadata: Metadata = {
  title: "About HermesPass — The KYA Thesis for Agentic AI",
  description:
    "HermesPass builds Know Your Agent infrastructure: open-standard identity, real-time authority and provable audit for the agents now acting inside enterprises.",
  openGraph: {
    title: "About HermesPass — The KYA Thesis",
    description:
      "Why agent identity, authority and evidence need dedicated infrastructure, and how HermesPass approaches it with open standards.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};
export default function AboutPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="About"
          title="Software agents became economic actors. The controls didn't follow."
          description="HermesPass exists to give autonomous agents the same three things we demand of any actor inside a regulated business: a verified identity, a bounded mandate, and a record that can be checked later."
        />
      </Section>

      <Section>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              icon: Target,
              title: "Mission",
              body: "Make agent autonomy governable, so enterprises can deploy agents on real workflows without accepting unbounded operational and regulatory risk.",
            },
            {
              icon: Compass,
              title: "The KYA thesis",
              body: "Know Your Customer made financial networks trustworthy. Agent networks need the same primitive: Know Your Agent — identity, authority and accountability, enforced at the point of action.",
            },
            {
              icon: Globe2,
              title: "Where we focus",
              body: "Hong Kong and Singapore first: dense regulated industries, active supervisory guidance on GenAI, and enterprises already piloting agentic workflows.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="panel p-6">
              <span className="grid size-10 place-items-center rounded-lg border border-cyan-accent/30 bg-cyan-accent/10 text-cyan-accent">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="border-y border-border bg-sidebar/40">
        <SectionHeading
          eyebrow="Principles"
          title="How we build"
          description="Choices we hold to, because governance infrastructure only earns trust if it is inspectable."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {[
            [
              "Open standards over lock-in",
              "Agent identity uses W3C DIDs and Verifiable Credentials so credentials remain verifiable outside our platform.",
            ],
            [
              "Enforce, don't observe",
              "Monitoring after the fact is not a control. Decisions happen before execution or they don't count.",
            ],
            [
              "Evidence by default",
              "Compliance artefacts are a by-product of enforcement, not a reporting project bolted on later.",
            ],
            [
              "Minimum data retained",
              "We store digests and decision metadata rather than duplicating sensitive payloads into another system.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="panel p-6">
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Roadmap"
          title="What we're building next"
          description="Sequenced with design partners running agents in production."
        />
        <ol className="mt-10 space-y-4">
          {[
            [
              "Now",
              "Passport issuance, policy gateway with human-in-the-loop review, scoped wallets and the hash-linked audit chain.",
            ],
            [
              "Next",
              "Policy-as-code authoring, delegated approval routing to messaging channels, and an evidence API for GRC tooling.",
            ],
            [
              "Later",
              "Cross-organisation agent verification, so a counterparty can verify an inbound agent's passport before transacting.",
            ],
          ].map(([phase, body]) => (
            <li key={phase} className="panel flex gap-5 p-6">
              <span className="font-mono text-[11px] tracking-wider text-emerald-accent uppercase">
                {phase}
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <CtaBand
        title="Become a design partner"
        description="We work closely with a small number of enterprises shaping how agent governance should work in practice."
      />
    </SiteShell>
  );
}
