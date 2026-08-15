import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  CreditCard,
  FileCheck2,
  Fingerprint,
  type LucideIcon,
} from "lucide-react";
import {
  CtaBand,
  Section,
  SectionHeading,
  SiteShell,
} from "@/components/marketing/site-shell";

export const Route = createFileRoute("/product")({
  head: () => ({
    meta: [
      { title: "Product — Agent Passports, Policy Gateway & Audit Chain" },
      {
        name: "description",
        content:
          "Inside HermesPass: DID and Verifiable Credential issuance, a real-time ALLOW/DENY/HOLD policy gateway, scoped virtual-card spend limits and a tamper-evident audit chain.",
      },
      {
        property: "og:title",
        content: "HermesPass Product — Identity, Authority, Spend, Evidence",
      },
      {
        property: "og:description",
        content:
          "How HermesPass issues agent passports, gates every tool call, caps agent spend and produces exportable compliance evidence.",
      },
    ],
  }),
  component: ProductPage,
});

const FEATURES: Array<{
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: Array<[string, string]>;
}> = [
  {
    icon: Fingerprint,
    eyebrow: "Identity",
    title: "Verifiable agent passports",
    body: "Each agent is registered once and receives a decentralized identifier plus a signed Verifiable Credential describing who owns it, what it may do and how risky it is. Any counterparty can verify the credential without calling HermesPass.",
    points: [
      "did:web identifiers resolvable to a public key",
      "W3C VC 2.0 JSON-LD credential with decoded inspector",
      "Risk tiering (low / medium / high) drives default policy",
      "Revocation and audit-hold states applied instantly at the gateway",
    ],
    visual: [
      ["subject", "did:web:hermespass.asia:agent:kinnso-rec"],
      ["issuer", "did:web:hermespass.asia"],
      ["scopes", "search.read · catalog.read · rank.write"],
      ["proof", "Ed25519Signature2020 · verified"],
    ],
  },
  {
    icon: Activity,
    eyebrow: "Authority",
    title: "Real-time policy gateway with human-in-the-loop",
    body: "Route agent tool calls through the gateway and every request is checked against the passport, the scope list and your policy thresholds before it reaches the target system.",
    points: [
      "Three-state decision: ALLOW, DENY, or HOLD for human mandate",
      "Holds route to a named reviewer with request context and policy reason",
      "Approve, reject or escalate — each outcome recorded as evidence",
      "Sub-second decisions with a streaming decision log",
    ],
    visual: [
      ["ALLOW", "catalog.read · within scope"],
      ["HOLD", "payment.create · above HKD 5,000 threshold"],
      ["DENY", "customer.export · scope not granted"],
      ["latency", "policy evaluated pre-execution"],
    ],
  },
  {
    icon: CreditCard,
    eyebrow: "Spend",
    title: "Scoped wallets and virtual cards",
    body: "When agents need to transact, they get a dedicated virtual card bounded by caps and merchant categories — not a shared corporate credential.",
    points: [
      "Per-transaction, daily and monthly ceilings per agent",
      "Merchant-category whitelists block out-of-policy purchases",
      "Live utilisation view against each cap",
      "Every authorisation carries the agent's passport reference",
    ],
    visual: [
      ["per transaction", "HKD 5,000"],
      ["daily", "HKD 25,000"],
      ["monthly", "HKD 300,000"],
      ["categories", "cloud · ads · logistics"],
    ],
  },
  {
    icon: FileCheck2,
    eyebrow: "Evidence",
    title: "Tamper-evident audit chain and exports",
    body: "Decisions are appended to a hash-linked ledger where each block references the digest of the previous one, so removal or edits are detectable.",
    points: [
      "Payload digests instead of raw sensitive data",
      "Signature validity shown per block",
      "Chain-integrity summary across the full log",
      "One-click CSV export and print-ready report",
    ],
    visual: [
      ["block", "#1042"],
      ["payloadHash", "b7f1…9ac2"],
      ["prevHash", "31de…5f08"],
      ["signature", "valid"],
    ],
  },
];

function ProductPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="Product"
          title="One control plane for the identity, authority and spend of every agent"
          description="HermesPass sits between your agent runtime and the systems it touches. Nothing executes without a verified passport and a recorded policy decision."
        />
      </Section>

      {FEATURES.map((f, i) => (
        <Section
          key={f.title}
          className={i % 2 === 1 ? "border-y border-border bg-sidebar/40" : ""}
        >
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <div className={i % 2 === 1 ? "lg:order-2" : ""}>
              <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
                <f.icon className="size-5" />
              </span>
              <p className="mt-4 font-mono text-[11px] tracking-[0.22em] text-cyan-accent uppercase">
                {f.eyebrow}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{f.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {f.body}
              </p>
              <ul className="mt-5 space-y-2.5">
                {f.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-accent" />
                    <span className="text-muted-foreground">{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel p-5">
              <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                {f.eyebrow} snapshot
              </p>
              <dl className="mt-4 divide-y divide-border">
                {f.visual.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                  >
                    <dt className="font-mono text-[11px] text-cyan-accent">
                      {k}
                    </dt>
                    <dd className="font-mono text-xs break-all text-muted-foreground">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </Section>
      ))}

      <Section>
        <SectionHeading
          eyebrow="Architecture"
          title="Drops in front of the tools your agents already call"
          description="No rewrite of your agents. Point the runtime or MCP server at the HermesPass gateway and attach the agent's passport to each call."
        />
        <div className="panel mt-8 overflow-x-auto p-6">
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
            {`  agent runtime / MCP client
          |
          |  signed request + passport reference
          v
  +-------------------------------+
  |     HermesPass gateway        |
  |  credential verify -> policy  |
  |  ALLOW      HOLD       DENY   |
  +-------------------------------+
     |          |            |
     v          v            v
  tools &   human review   blocked
  payments  (mandate)      + logged
     |          |            |
     +----------+------------+
                |
                v
       hash-linked audit chain -> CSV / report export`}
          </pre>
        </div>

        <div className="panel mt-6 overflow-x-auto p-6">
          <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            Illustrative gateway call
          </p>
          <pre className="mt-4 font-mono text-xs leading-relaxed text-muted-foreground">
            {`POST /v1/gateway/authorize
{
  "agent": "did:web:hermespass.asia:agent:autoprocure-bot",
  "tool": "payment.create",
  "params": { "amount": 8400, "currency": "HKD", "mcc": "5734" }
}

-> { "decision": "hold",
     "reason": "amount above per-transaction cap",
     "reviewRef": "hold_9f31c" }`}
          </pre>
        </div>
      </Section>

      <CtaBand />
    </SiteShell>
  );
}
