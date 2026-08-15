import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Boxes,
  FileCheck2,
  FileText,
  Fingerprint,
  KeyRound,
  Link2,
  Lock,
  Mail,
  ScrollText,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import {
  CtaBand,
  Section,
  SectionHeading,
  SiteShell,
} from "@/components/marketing/site-shell";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Trust Center — HermesPass Security & Compliance" },
      {
        name: "description",
        content:
          "How HermesPass secures agent identity, authority and spend, what compliance artifacts we share under review, and how our hash-chain audit log works.",
      },
      {
        property: "og:title",
        content: "HermesPass Trust Center — Security, Compliance, Audit Chain",
      },
      {
        property: "og:description",
        content:
          "Our security posture, the artifacts we provide to enterprise reviewers, and a public explanation of tamper-evident hash-chain audit logging.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SecurityPage,
});

const POSTURE = [
  {
    icon: Fingerprint,
    title: "Agent identity, not shared secrets",
    body: "Each agent is issued a resolvable did:web identifier and a signed credential. Gateway calls are attributed to that agent instead of a shared service account.",
  },
  {
    icon: ShieldCheck,
    title: "Authority enforced at runtime",
    body: "Gated tool calls receive an allow, hold or deny decision against the agent's active policy. Nothing outside the granted scope executes.",
  },
  {
    icon: KeyRound,
    title: "Least privilege by default",
    body: "New passports start with the narrowest scope required for the workflow. Widening scope is an explicit control-plane change, not a code change.",
  },
  {
    icon: UserCheck,
    title: "Human-in-the-loop for high impact",
    body: "Actions above configured thresholds hold for a named human reviewer, and the reviewer's decision is recorded alongside the action.",
  },
  {
    icon: Lock,
    title: "Scoped spend controls",
    body: "Payment authority is bounded by per-agent caps and merchant-category whitelists, so a compromised agent cannot spend outside its envelope.",
  },
  {
    icon: ScrollText,
    title: "Evidence produced automatically",
    body: "Every decision is appended to an append-only audit chain, so reviews draw on recorded events rather than reconstructed narratives.",
  },
];

const CHAIN_STEPS = [
  {
    n: "01",
    title: "Action is captured",
    body: "When an agent calls a gated tool or payment rail, the gateway records the agent identifier, the action, the policy decision and the timestamp.",
  },
  {
    n: "02",
    title: "Payload is hashed",
    body: "The record is serialised and hashed. The stored block keeps the hash rather than relying on a mutable copy of the raw payload for integrity.",
  },
  {
    n: "03",
    title: "Previous hash is sealed in",
    body: "Each block also stores the hash of the block before it, so blocks form a chain in which position and content are bound together.",
  },
  {
    n: "04",
    title: "Verification detects edits",
    body: "Re-walking the chain recomputes each link. Editing, reordering or deleting any earlier block breaks every hash after it, which is what makes the log tamper-evident.",
  },
];

const ARTIFACTS = [
  {
    icon: FileText,
    title: "Architecture and data-flow overview",
    body: "How agent traffic reaches the gateway, what is evaluated, and what is written to the audit chain.",
  },
  {
    icon: FileCheck2,
    title: "Control mapping",
    body: "Our controls mapped to the standards and frameworks we build to, as documented on the compliance page.",
  },
  {
    icon: Boxes,
    title: "Subprocessor and hosting summary",
    body: "The infrastructure providers involved in operating the service, provided for vendor review.",
  },
  {
    icon: Link2,
    title: "Audit-chain verification notes",
    body: "How to independently verify an exported chain, including the field layout of each block.",
  },
];

function SecurityPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop">
        <p className="font-mono text-[11px] tracking-[0.22em] text-emerald-accent uppercase">
          Trust Center
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          Security posture, compliance artifacts and a public audit-chain
          explanation
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          HermesPass exists to make autonomous agents accountable, so we hold
          our own platform to the same standard: bounded authority, attributable
          actions and evidence that can be checked rather than trusted. This
          page describes how the platform is built and which documents we share
          with enterprise reviewers.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/contact"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
          >
            Request security review pack <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/compliance-standards"
            className="inline-flex items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
          >
            See standards we build to
          </Link>
        </div>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Security posture"
          title="Controls that are part of the product, not policy language"
          description="Each item below reflects how the platform behaves. Where a control depends on your configuration, thresholds are set by your risk owners in the control plane."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {POSTURE.map((item) => (
            <div key={item.title} className="panel p-6">
              <span className="grid size-9 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent">
                <item.icon className="size-4" />
              </span>
              <h3 className="mt-4 text-sm font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Hash-chain audit logging"
          title="How the tamper-evident audit chain works"
          description="The audit log is append-only. Blocks are linked by hashes so that any retroactive change is detectable by anyone holding an export."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-4">
          {CHAIN_STEPS.map((s) => (
            <div key={s.n} className="panel p-6">
              <p className="font-mono text-[11px] tracking-[0.22em] text-cyan-accent">
                {s.n}
              </p>
              <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          ))}
        </div>

        <div className="panel mt-6 overflow-x-auto p-6">
          <p className="text-xs font-semibold tracking-wide uppercase">
            Block structure
          </p>
          <pre className="mt-4 font-mono text-xs leading-relaxed text-muted-foreground">
{`block {
  index          : sequential position in the chain
  timestamp      : UTC time the decision was recorded
  agent_did      : issuer-resolvable identifier of the acting agent
  action         : the gated tool call or payment attempted
  decision       : ALLOW | HOLD | DENY (plus reviewer, when held)
  payload_hash   : hash of the serialised action record
  previous_hash  : payload hash of block[index - 1]
  signature      : signature over the block contents
}`}
          </pre>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
            Verification recomputes each block's hash and checks that it matches
            the <span className="font-mono text-xs">previous_hash</span> stored
            by its successor. A single altered field breaks the chain from that
            point forward, which is why the log is described as tamper-evident
            rather than merely access-controlled.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/dashboard/compliance"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-sm transition-colors hover:bg-surface-raised"
            >
              View the chain in the live demo <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Compliance artifacts"
          title="What we share with enterprise reviewers"
          description="These documents are provided on request under a mutual NDA as part of a security or vendor review. We do not publish claims about certifications or audit outcomes that have not been completed and confirmed."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {ARTIFACTS.map((a) => (
            <div key={a.title} className="panel flex gap-4 p-6">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-accent/40 bg-cyan-accent/10 text-cyan-accent">
                <a.icon className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {a.body}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
          If your review requires an artifact not listed here, tell us what it
          is and we will confirm whether we can provide it, provide an
          equivalent, or state plainly that it does not exist yet.
        </p>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Reporting"
          title="Report a vulnerability"
          description="We welcome coordinated disclosure and will acknowledge reports from a real reviewer promptly."
        />
        <div className="panel mt-8 flex flex-wrap items-center gap-4 p-6">
          <span className="grid size-9 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent">
            <Mail className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Security contact</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Send details, reproduction steps and impact through the{" "}
              <Link to="/contact" className="text-emerald-accent underline-offset-4 hover:underline">
                contact form
              </Link>{" "}
              and mark the message as a security report. Please do not test
              against production tenants you do not own.
            </p>
          </div>
        </div>
      </Section>

      <CtaBand
        title="Bring your security questionnaire"
        description="We will walk your reviewers through identity issuance, gateway enforcement, spend scoping and audit-chain verification in one session."
      />
    </SiteShell>
  );
}
