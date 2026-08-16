import type { Metadata } from "next";
import { FileOutput, Fingerprint, Gavel } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CtaBand, Section, SectionHeading, SiteShell } from "@/components/marketing/site-shell";

export const metadata: Metadata = {
  title: "FAQ — HermesPass Agent Passports, Approvals & Reporting",
  description:
    "Answers on agent passports, human-in-the-loop approvals, spend controls, audit exports and regulator-ready reporting.",
  openGraph: {
    title: "HermesPass FAQ — Agent Governance, Approvals & Reporting",
    description:
      "How agent passports work, how human-in-the-loop approvals operate, and how compliance evidence is exported.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};
const FAQ_SECTIONS = [
  {
    id: "passports",
    icon: Fingerprint,
    eyebrow: "Agent passports",
    title: "Verifiable identity for every agent",
    items: [
      {
        q: "What is an agent passport?",
        a: "An agent passport is a W3C Verifiable Credential that binds a non-human actor to a resolvable identifier, a risk tier, an owner and a delegated scope. It is the proof of identity a gateway or auditor can check without relying on a borrowed service account.",
      },
      {
        q: "How is a passport issued?",
        a: "A product owner or agent operator submits the agent's purpose, data access, tool scope and spend authority. Risk or compliance reviews the profile, sets the risk tier and signs the credential. Once issued, the passport is resolvable and can be revoked or re-issued when scope changes.",
      },
      {
        q: "What identifier does an agent use?",
        a: "HermesPass uses did:web identifiers tied to your domain, so the agent is a first-class entity in your namespace rather than a shared API key. The DID resolves to a DID document with public keys and service endpoints.",
      },
      {
        q: "Can a passport expire or be revoked?",
        a: "Yes. Passports carry an expiry date and are revocable by the issuer or a delegated administrator. The gateway checks revocation status on every gated request, so a decommissioned or over-scoped agent cannot keep operating.",
      },
      {
        q: "Does this replace our identity provider?",
        a: "No. HermesPass sits next to IAM. It answers the question, 'What is this agent allowed to do right now?' using a credential that carries purpose, risk and delegated authority — not just authentication.",
      },
    ],
  },
  {
    id: "approvals",
    icon: Gavel,
    eyebrow: "Human-in-the-loop approvals",
    title: "Real-time authority checks with human oversight",
    items: [
      {
        q: "How does the policy gateway decide allow, hold or deny?",
        a: "The gateway evaluates the agent's passport, the requested action, risk tier, spend limits, merchant category and any policy rules your team has configured. It returns allow, hold or deny in milliseconds and writes the decision to the audit chain.",
      },
      {
        q: "What happens when a request is held?",
        a: "A held request is routed to a named reviewer with the full context: the agent passport, the policy reason, the requested payload digest and the business justification. The reviewer can approve, deny or request more information.",
      },
      {
        q: "Who can be a reviewer?",
        a: "Reviewers are assigned by role or by policy area — for example, a procurement lead for high-value spend, a data protection officer for sensitive data access, or a risk manager for cross-border actions.",
      },
      {
        q: "Can we set different thresholds for different agents?",
        a: "Yes. Each agent passport carries a risk tier and delegated scope, and policies can be written per tier, per team or per tool. A low-risk internal assistant can have wider autonomy; a high-risk procurement agent faces tighter ceilings.",
      },
      {
        q: "Does this slow down agents?",
        a: "Allow and deny decisions are automated and synchronous. Only edge cases that breach a threshold are held for human review, which is exactly where oversight is needed without becoming a bottleneck.",
      },
    ],
  },
  {
    id: "reporting",
    icon: FileOutput,
    eyebrow: "Export & reporting",
    title: "Audit-ready evidence in one click",
    items: [
      {
        q: "What does the audit chain record?",
        a: "Every gateway decision is recorded as a hash-linked entry containing the agent DID, the decision, the policy version, the payload digest and a timestamp. The chain is append-only and tamper-evident.",
      },
      {
        q: "How do I export audit evidence?",
        a: "From the compliance hub you can export a date range as CSV or as a structured report. The export includes the decision log, linked hashes and a manifest that lets a reviewer verify the chain has not been altered.",
      },
      {
        q: "Can we integrate this into our SIEM or GRC tool?",
        a: "Enterprise plans include API access to the audit stream. You can forward decisions to a SIEM, store evidence in a GRC repository or push a daily summary to a compliance inbox.",
      },
      {
        q: "What retention options are available?",
        a: "Pilot includes 90-day retention. Growth extends this to 12 months. Enterprise matches your corporate policy, whether that is three, seven or ten years.",
      },
      {
        q: "Which frameworks does the evidence map to?",
        a: "The hash-linked audit log, role-based reviewer assignment and scoped controls map directly to IMDA Model AI Governance for GenAI, HKMA GenA.I. Sandbox expectations and the EU AI Act's risk-management and record-keeping obligations.",
      },
    ],
  },
] as const;

const CROSS_CUTTING = [
  {
    q: "How long does it take to deploy?",
    a: "Pilot deployments typically go live in a few days by routing one high-impact tool through the gateway. Enterprise rollouts are phased by agent team and can take four to eight weeks depending on integrations and policy design.",
  },
  {
    q: "What data does HermesPass process?",
    a: "The gateway evaluates metadata and writes payload digests. Raw payloads, personal data and proprietary content can remain in your systems. We process only what is needed to make an authorization decision and produce evidence.",
  },
  {
    q: "Can we run this in our own cloud?",
    a: "Enterprise customers can choose a managed deployment aligned with their region and residency requirements. Talk to us about private cloud, VPC and multi-region options.",
  },
] as const;

export default function FaqPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="FAQ"
          title="Answers for risk, compliance and engineering teams"
          description="How agent passports, human-in-the-loop approvals and regulator-ready exports work in practice."
        />
      </Section>

      {FAQ_SECTIONS.map(({ id, icon: Icon, eyebrow, title, items }) => (
        <Section key={id} id={id} className="border-b border-border">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
              <Icon className="size-5" />
            </span>
            <SectionHeading eyebrow={eyebrow} title={title} />
          </div>
          <Accordion type="single" collapsible className="mt-8 max-w-3xl">
            {items.map((item) => (
              <AccordionItem key={item.q} value={item.q}>
                <AccordionTrigger className="text-left text-sm">{item.q}</AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>
      ))}

      <Section id="general">
        <SectionHeading eyebrow="General" title="Deployment, data and operations" />
        <Accordion type="single" collapsible className="mt-8 max-w-3xl">
          {CROSS_CUTTING.map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger className="text-left text-sm">{item.q}</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      <CtaBand
        title="Still have questions?"
        description="Our team can walk through passports, policy thresholds, approval workflows and audit exports in a 30-minute briefing."
      />
    </SiteShell>
  );
}
