import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CtaBand,
  Section,
  SectionHeading,
  SiteShell,
} from "@/components/marketing/site-shell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Pilot, Growth and Enterprise Plans | HermesPass" },
      {
        name: "description",
        content:
          "Indicative HermesPass plans by agent count, gateway volume and audit retention — from a governed pilot to enterprise-wide agent compliance.",
      },
      {
        property: "og:title",
        content: "HermesPass Pricing — Pilot, Growth, Enterprise",
      },
      {
        property: "og:description",
        content:
          "Plans scale with governed agents, gateway decision volume and audit retention. Talk to us for a scoped quote.",
      },
    ],
  }),
  component: PricingPage,
});

const TIERS = [
  {
    name: "Pilot",
    tagline: "Prove the control model on one agent team",
    price: "Scoped engagement",
    highlight: false,
    features: [
      "Up to 10 governed agents",
      "Policy gateway with hold review",
      "90-day audit retention",
      "CSV export",
      "Shared onboarding session",
    ],
  },
  {
    name: "Growth",
    tagline: "Roll governance across business units",
    price: "Volume-based",
    highlight: true,
    features: [
      "Up to 250 governed agents",
      "Scoped wallets and MCC whitelists",
      "12-month audit retention",
      "CSV plus report export",
      "Custom policy thresholds",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    tagline: "Group-wide agent compliance",
    price: "Custom",
    highlight: false,
    features: [
      "Unlimited governed agents",
      "Multi-entity and multi-region setup",
      "Extended retention to your policy",
      "Regulator submission support",
      "Dedicated compliance engineer",
      "Deployment options on request",
    ],
  },
] as const;

const COMPARISON: Array<[string, string, string, string]> = [
  ["Governed agents", "10", "250", "Unlimited"],
  ["Gateway decisions / month", "100k", "5M", "Negotiated"],
  ["Audit retention", "90 days", "12 months", "Your policy"],
  ["Human-in-the-loop review", "Included", "Included", "Included"],
  ["Scoped wallets", "Read-only demo", "Included", "Included"],
  ["Legal entities", "1", "5", "Unlimited"],
  ["Export formats", "CSV", "CSV + report", "CSV + report + API"],
  ["Support", "Business hours", "Priority", "Dedicated"],
];

const FAQ = [
  {
    q: "How is an agent counted?",
    a: "By issued passport. An agent that has been revoked no longer counts toward your plan, and short-lived agent instances sharing one passport count once.",
  },
  {
    q: "Do you need access to our data?",
    a: "No. The gateway evaluates request metadata and writes payload digests, so raw payloads and personal data can stay in your systems.",
  },
  {
    q: "Can we start without changing our agents?",
    a: "Yes. Most teams begin by routing one high-impact tool — usually payments or data export — through the gateway, then widen scope.",
  },
  {
    q: "Are these prices final?",
    a: "The figures here are indicative bands to help you size a plan. Final pricing depends on agent count, decision volume and retention requirements.",
  },
] as const;

function PricingPage() {
  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="Pricing"
          title="Plans that scale with governed agents, not seats"
          description="Pricing follows the number of agent passports you issue, the decision volume through the gateway and how long you must retain evidence."
          align="center"
        />
      </Section>

      <Section>
        <div className="grid gap-5 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={cn(
                "panel flex flex-col p-6",
                t.highlight && "shadow-glow-emerald",
              )}
            >
              {t.highlight ? (
                <span className="mb-3 self-start rounded-full border border-emerald-accent/40 bg-emerald-accent/10 px-2.5 py-0.5 font-mono text-[10px] tracking-wider text-emerald-accent uppercase">
                  Most adopted
                </span>
              ) : null}
              <h2 className="text-lg font-semibold">{t.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t.tagline}</p>
              <p className="mt-5 font-mono text-xl font-semibold text-emerald-accent">
                {t.price}
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-accent" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/contact"
                className={cn(
                  "mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                  t.highlight
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "border border-border bg-surface hover:bg-surface-raised",
                )}
              >
                Talk to us
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Bands are indicative and confirmed during scoping.
        </p>
      </Section>

      <Section className="border-y border-border bg-sidebar/40">
        <SectionHeading eyebrow="Compare" title="What each plan includes" />
        <div className="panel mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Capability
                </th>
                {TIERS.map((t) => (
                  <th
                    key={t.name}
                    className="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {COMPARISON.map(([label, a, b, c]) => (
                <tr key={label}>
                  <td className="px-4 py-3 font-medium">{label}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="FAQ" title="Common questions" />
        <Accordion type="single" collapsible className="mt-8 max-w-3xl">
          {FAQ.map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger className="text-left text-sm">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      <CtaBand
        title="Get a scoped quote"
        description="Tell us your agent count, the tools they call and your retention requirement — we'll come back with a plan."
      />
    </SiteShell>
  );
}
