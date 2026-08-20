import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CreditCard,
  FileCheck2,
  Fingerprint,
  Link2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { CtaBand, Section, SectionHeading, SiteShell } from "@/components/marketing/site-shell";

export const metadata: Metadata = {
  title: "HermesPass — Know Your Agent Infrastructure for AI Agents",
  description:
    "HermesPass gives every enterprise AI agent a verifiable digital passport, a real-time policy gateway, scoped payment limits and a tamper-evident audit chain.",
  openGraph: {
    title: "HermesPass — Know Your Agent Infrastructure for AI Agents",
    description:
      "Issue verifiable agent passports, gate every tool call in real time, cap agent spend and export regulator-ready audit evidence.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};
const PILLARS = [
  {
    icon: Fingerprint,
    title: "Agent passports",
    body: "Every agent gets a DID and a W3C Verifiable Credential stating its owner, role, risk tier and permitted tool scopes — cryptographically signed and independently verifiable.",
  },
  {
    icon: Activity,
    title: "Policy gateway",
    body: "Each tool call is checked against policy before it executes and returns ALLOW, DENY or HOLD. High-impact actions escalate to a named human for a recorded mandate.",
  },
  {
    icon: CreditCard,
    title: "Scoped wallets",
    body: "Agents transact through virtual cards with per-transaction, daily and monthly caps plus merchant-category whitelists, so autonomy never means unbounded spend.",
  },
  {
    icon: FileCheck2,
    title: "Audit chain",
    body: "Every decision is written to a hash-linked ledger with payload digests and signature verification, exportable as CSV or a print-ready compliance report.",
  },
] as const;

const STANDARDS = [
  "W3C Verifiable Credentials 2.0",
  "W3C DID Core",
  "IMDA Model AI Governance for GenAI",
  "HKMA GenA.I. Sandbox",
  "Model Context Protocol (MCP)",
] as const;

export default function HomePage() {
  return (
    <SiteShell>
      <section className="grid-backdrop border-b border-border px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-accent/40 bg-cyan-accent/10 px-3 py-1 font-mono text-[11px] tracking-wider text-cyan-accent uppercase">
            <Sparkles className="size-3.5" /> KYA · Know Your Agent
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            The digital passport and compliance layer for{" "}
            <span className="text-emerald-accent">AI agents</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Enterprises are deploying agents that call tools, move money and touch customer data —
            with no identity, no authority boundary and no audit trail. HermesPass issues verifiable
            agent passports, gates every action in real time, and produces the evidence your
            regulator and your board expect.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/contact"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
            >
              Book a briefing <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
            >
              Explore the live demo
            </Link>
          </div>

          <div className="panel mt-14 grid gap-5 p-6 sm:grid-cols-3">
            <HeroStat
              label="Identity"
              value="did:web"
              detail="Resolvable agent identifiers with signed credentials"
            />
            <HeroStat
              label="Authority"
              value="ALLOW / HOLD / DENY"
              detail="Policy decision on every gated tool call"
            />
            <HeroStat
              label="Evidence"
              value="Hash-linked"
              detail="Tamper-evident ledger with one-click export"
            />
          </div>
        </div>
      </section>

      <div className="border-b border-border bg-sidebar px-5 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <span className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            Built to
          </span>
          {STANDARDS.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <BadgeCheck className="size-3.5 text-emerald-accent" />
              {s}
            </span>
          ))}
        </div>
      </div>

      <Section>
        <SectionHeading
          eyebrow="The gap"
          title="Agentic AI broke the identity model"
          description="Your controls assume a human actor behind every request. Agents don't fit: they're ephemeral, they chain tools together, and they act at machine speed."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Unknown actors",
              body: "Agents authenticate with borrowed service credentials, so logs show a system account instead of which agent acted, under whose mandate.",
            },
            {
              title: "Unbounded authority",
              body: "An agent granted an API key inherits everything that key can do — including transactions and data exports nobody scoped for autonomy.",
            },
            {
              title: "Unprovable history",
              body: "Application logs are mutable and scattered. When a regulator asks what an agent did and who authorised it, there is no defensible answer.",
            },
          ].map((item) => (
            <div key={item.title} className="panel p-6">
              <ShieldAlert className="size-5 text-risk-high" />
              <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="border-t border-border bg-sidebar/40">
        <SectionHeading
          eyebrow="The platform"
          title="Four controls, one control plane"
          description="Identity, authority, spend and evidence — issued once per agent and enforced on every action."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="panel p-6">
              <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link
            href="/product"
            className="inline-flex items-center gap-1.5 text-sm text-cyan-accent hover:underline"
          >
            See how each control works <ArrowRight className="size-4" />
          </Link>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="How it works" title="From issuance to evidence in three steps" />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Issue the passport",
              body: "Register the agent, its owning entity, risk tier, tool scopes and spend ceiling. HermesPass mints a DID and signs a Verifiable Credential.",
            },
            {
              step: "02",
              title: "Route calls through the gateway",
              body: "Point your agent runtime or MCP server at HermesPass. Each call is verified against the passport and policy, then allowed, held for a human, or denied.",
            },
            {
              step: "03",
              title: "Export the evidence",
              body: "Every decision, payload digest and human mandate lands in the hash-linked audit chain, ready to export for internal audit or a supervisor.",
            },
          ].map((s) => (
            <div key={s.step} className="panel p-6">
              <span className="font-mono text-xs text-cyan-accent">{s.step}</span>
              <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="panel mt-8 flex flex-wrap items-center justify-center gap-3 p-6 font-mono text-[11px] tracking-wide text-muted-foreground">
          <span className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5">
            AI agent
          </span>
          <Link2 className="size-3.5 text-cyan-accent" />
          <span className="rounded-md border border-emerald-accent/40 bg-emerald-accent/10 px-2.5 py-1.5 text-emerald-accent">
            HermesPass gateway
          </span>
          <Link2 className="size-3.5 text-cyan-accent" />
          <span className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5">
            Tools · APIs · payments
          </span>
          <Link2 className="size-3.5 text-cyan-accent" />
          <span className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5">
            Hash-linked audit chain
          </span>
        </div>
      </Section>

      <Section className="border-t border-border bg-sidebar/40">
        <SectionHeading
          eyebrow="Where it lands"
          title="Built for regulated, high-velocity operations"
          description="Any team where an agent can spend money, touch customer data or act on a customer's behalf."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Banking & insurance", "Agent mandates evidenced per action"],
            ["Commerce platforms", "Merchant-scoped agent purchasing"],
            ["Ad tech & agencies", "Budget caps on optimisation agents"],
            ["Procurement & BPO", "Approval thresholds with human sign-off"],
          ].map(([title, detail]) => (
            <div key={title} className="panel p-5">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link
            href="/solutions"
            className="inline-flex items-center gap-1.5 text-sm text-cyan-accent hover:underline"
          >
            Read the solution detail <ArrowRight className="size-4" />
          </Link>
        </div>
      </Section>

      <CtaBand />
    </SiteShell>
  );
}

function HeroStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-mono text-lg font-semibold text-emerald-accent">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
