import { createFileRoute, Link } from "@tanstack/react-router";
import { FileDown, Landmark, Lock, ScrollText } from "lucide-react";
import {
  CtaBand,
  Section,
  SectionHeading,
  SiteShell,
} from "@/components/marketing/site-shell";

export const Route = createFileRoute("/compliance-standards")({
  head: () => ({
    meta: [
      { title: "Compliance & Standards — IMDA, HKMA, W3C | HermesPass" },
      {
        name: "description",
        content:
          "How HermesPass maps agent controls to IMDA Model AI Governance for GenAI, the HKMA GenA.I. Sandbox, PDPO/PDPA data handling and W3C DID/VC standards.",
      },
      {
        property: "og:title",
        content: "HermesPass Compliance — Standards and Control Mapping",
      },
      {
        property: "og:description",
        content:
          "Control mapping, evidence model and export formats for agent governance in Hong Kong and Singapore.",
      },
    ],
  }),
  component: CompliancePage,
});

const FRAMEWORKS = [
  {
    icon: Landmark,
    title: "IMDA Model AI Governance Framework for Generative AI",
    body: "Singapore's framework asks for accountability, traceability and meaningful human oversight. HermesPass provides the per-action record and the human-mandate step those dimensions rely on.",
  },
  {
    icon: Landmark,
    title: "HKMA GenA.I. Sandbox",
    body: "Supervised GenAI pilots need demonstrable risk controls and monitoring. Passports, thresholds and the audit chain give supervisors a legible control narrative for agentic use cases.",
  },
  {
    icon: Lock,
    title: "PDPO (HK) & PDPA (SG) data handling",
    body: "The audit chain stores payload digests rather than raw payloads by default, so evidence is verifiable without duplicating personal data into a second store.",
  },
  {
    icon: ScrollText,
    title: "W3C DID Core & Verifiable Credentials 2.0",
    body: "Agent identity uses open standards rather than a proprietary registry, so credentials can be verified by counterparties and survive vendor change.",
  },
] as const;

const MAPPING: Array<[string, string, string]> = [
  [
    "Accountability & ownership",
    "Passport binds every agent to an owning legal entity and internal owner",
    "Agent passports",
  ],
  [
    "Least privilege",
    "Tool scopes are explicit; anything unlisted is denied at the gateway",
    "Policy gateway",
  ],
  [
    "Human oversight",
    "Value and sensitivity thresholds force a HOLD and a named approver",
    "Human-in-the-loop review",
  ],
  [
    "Financial control",
    "Per-transaction, daily and monthly caps plus merchant-category limits",
    "Scoped wallets",
  ],
  [
    "Traceability",
    "Hash-linked blocks with payload digests and signature verification",
    "Audit chain",
  ],
  [
    "Incident response",
    "Instant revocation or audit-hold applied at the enforcement point",
    "Passport lifecycle",
  ],
  [
    "Reporting",
    "CSV export and print-ready report over any period",
    "Compliance exporter",
  ],
];

function CompliancePage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="Compliance"
          title="Evidence designed for the questions supervisors actually ask"
          description="Which agent acted, under whose authority, within what limits, and can you prove the record wasn't altered? HermesPass answers all four from one ledger."
        />
      </Section>

      <Section>
        <div className="grid gap-5 sm:grid-cols-2">
          {FRAMEWORKS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="panel p-6">
              <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          HermesPass supports your compliance work against these frameworks.
          Alignment is a shared responsibility with your own risk, legal and
          compliance functions — no framework certifies a vendor on your behalf.
        </p>
      </Section>

      <Section className="border-y border-border bg-sidebar/40">
        <SectionHeading
          eyebrow="Control mapping"
          title="Governance expectation to HermesPass control"
        />
        <div className="panel mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Expectation
                </th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  How it is enforced
                </th>
                <th className="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Control
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {MAPPING.map(([expectation, how, control]) => (
                <tr key={expectation}>
                  <td className="px-4 py-3 font-medium">{expectation}</td>
                  <td className="px-4 py-3 text-muted-foreground">{how}</td>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-accent">
                    {control}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Evidence & export"
          title="From ledger to regulator pack"
          description="Auditors get a self-checking record instead of a stitched-together log extract."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Chain integrity check",
              body: "Each block references the previous digest, so any gap or edit surfaces as a broken chain in the integrity summary.",
            },
            {
              title: "Signature verification",
              body: "Blocks carry the issuing signature; verification state is shown per row in the audit log.",
            },
            {
              title: "One-click packs",
              body: "Export the filtered log to CSV, or generate a print-ready report for a supervisory submission.",
            },
          ].map((c) => (
            <div key={c.title} className="panel p-6">
              <FileDown className="size-5 text-cyan-accent" />
              <h3 className="mt-4 text-base font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {c.body}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link
            to="/dashboard/compliance"
            className="inline-flex items-center gap-1.5 text-sm text-cyan-accent hover:underline"
          >
            Inspect the audit chain in the live demo
          </Link>
        </div>
      </Section>

      <CtaBand
        title="Walk your control matrix with us"
        description="Bring your internal control list and we'll show which HermesPass evidence satisfies each line."
      />
    </SiteShell>
  );
}
