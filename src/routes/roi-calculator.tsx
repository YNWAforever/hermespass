import { createFileRoute } from "@tanstack/react-router";
import { Calculator, Clock, DollarSign, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CtaBand,
  Section,
  SectionHeading,
  SiteShell,
} from "@/components/marketing/site-shell";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/roi-calculator")({
  head: () => ({
    meta: [
      { title: "ROI Calculator — HermesPass KYA Savings" },
      {
        name: "description",
        content:
          "Estimate how much compliance review time and ungoverned agent spend HermesPass can save your enterprise.",
      },
      {
        property: "og:title",
        content: "HermesPass ROI Calculator — Agent Governance Savings",
      },
      {
        property: "og:description",
        content:
          "Estimate compliance review time saved and spend governance impact from Know Your Agent infrastructure.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RoiCalculatorPage,
});

function currency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function hours(n: number) {
  return `${Math.round(n).toLocaleString()} hrs`;
}

const LABOUR_TIME_REDUCTION = 0.8; // 80% of manual review time removed
const SPEND_CAPTURE_RATE = 0.6; // 60% of unmanaged spend is recovered or prevented

function RoiCalculatorPage() {
  const [agents, setAgents] = useState(25);
  const [reviewsPerAgent, setReviewsPerAgent] = useState(2);
  const [hoursPerReview, setHoursPerReview] = useState(4);
  const [hourlyRate, setHourlyRate] = useState(180);
  const [monthlySpend, setMonthlySpend] = useState(50000);
  const [outOfPolicyRate, setOutOfPolicyRate] = useState(4);

  const results = useMemo(() => {
    const monthlyReviewHours = agents * reviewsPerAgent * hoursPerReview;
    const monthlyComplianceCost = monthlyReviewHours * hourlyRate;
    const timeSavedHours = monthlyReviewHours * LABOUR_TIME_REDUCTION;
    const labourSaved = monthlyComplianceCost * LABOUR_TIME_REDUCTION;
    const unmanagedSpend = monthlySpend * (outOfPolicyRate / 100);
    const spendGovernanceValue = unmanagedSpend * SPEND_CAPTURE_RATE;
    const monthlyTotal = labourSaved + spendGovernanceValue;
    const annualTotal = monthlyTotal * 12;
    const annualHours = timeSavedHours * 12;

    return {
      monthlyReviewHours,
      monthlyComplianceCost,
      timeSavedHours,
      labourSaved,
      unmanagedSpend,
      spendGovernanceValue,
      monthlyTotal,
      annualTotal,
      annualHours,
    };
  }, [agents, reviewsPerAgent, hoursPerReview, hourlyRate, monthlySpend, outOfPolicyRate]);

  return (
    <SiteShell>
      <Section className="grid-backdrop border-b border-border">
        <SectionHeading
          eyebrow="ROI Calculator"
          title="Estimate the cost of ungoverned agents"
          description="Adjust the inputs to see how much compliance review time and out-of-policy spend HermesPass can recover each year."
        />
      </Section>

      <Section>
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="panel divide-y divide-border">
              <InputRow
                icon={ShieldCheck}
                label="Number of agents"
                value={agents}
                onChange={setAgents}
                min={1}
                max={500}
                step={1}
                suffix=" agents"
                description="Agents, copilots, autonomous workflows or tool-calling services that need governance."
              />
              <InputRow
                icon={ShieldCheck}
                label="Compliance reviews per agent / month"
                value={reviewsPerAgent}
                onChange={setReviewsPerAgent}
                min={0}
                max={20}
                step={1}
                suffix=" reviews"
                description="New deployments, scope changes, access recertifications or incident follow-ups."
              />
              <InputRow
                icon={Clock}
                label="Average review time"
                value={hoursPerReview}
                onChange={setHoursPerReview}
                min={0.5}
                max={24}
                step={0.5}
                suffix=" hrs"
                description="Hours spent by risk, legal or security reviewing each agent before it can operate."
              />
              <InputRow
                icon={DollarSign}
                label="Compliance staff cost"
                value={hourlyRate}
                onChange={setHourlyRate}
                min={50}
                max={500}
                step={10}
                prefix="$"
                suffix=" / hr"
                description="Fully loaded hourly cost of the reviewers doing the work."
              />
              <InputRow
                icon={DollarSign}
                label="Monthly agent-initiated spend"
                value={monthlySpend}
                onChange={setMonthlySpend}
                min={1000}
                max={500000}
                step={1000}
                prefix="$"
                description="Total spend flowing through agents: SaaS procurement, API calls, services, ad spend, etc."
              />
              <InputRow
                icon={DollarSign}
                label="Estimated out-of-policy / unmanaged rate"
                value={outOfPolicyRate}
                onChange={setOutOfPolicyRate}
                min={0}
                max={25}
                step={0.5}
                suffix="%"
                description="The share of agent spend that is miscoded, unapproved, over-budget or outside scope."
              />
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="panel sticky top-24">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
                  <Calculator className="size-5" />
                </span>
                <h3 className="text-lg font-semibold">Estimated annual impact</h3>
              </div>

              <div className="mt-6 grid gap-4">
                <ResultCard
                  label="Compliance time saved"
                  value={hours(results.annualHours)}
                  hint="Equivalent reviewer hours freed by automated passport issuance and policy pre-checks."
                />
                <ResultCard
                  label="Compliance labour cost avoided"
                  value={currency(results.labourSaved * 12)}
                  hint="Direct savings from shorter, reusable governance reviews."
                />
                <ResultCard
                  label="Spend governance value"
                  value={currency(results.spendGovernanceValue * 12)}
                  hint="Out-of-policy spend prevented or recovered through scoped controls and audit."
                />
                <div className="rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 p-5">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-emerald-accent">
                    Total estimated annual savings
                  </p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-accent">
                    {currency(results.annualTotal)}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Model assumptions</p>
                <ul className="mt-2 space-y-1.5 text-xs">
                  <li>
                    • {Math.round(LABOUR_TIME_REDUCTION * 100)}% reduction in manual review time after KYA passporting
                  </li>
                  <li>
                    • {Math.round(SPEND_CAPTURE_RATE * 100)}% of unmanaged spend is prevented or recovered through scoped controls
                  </li>
                  <li>• Values are estimates; actual savings depend on policy maturity and agent estate</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <CtaBand
        title="Get a tailored business case"
        description="Send us your inputs and we will return a board-ready proposal with your governance gaps, rollout plan and projected ROI."
      />
    </SiteShell>
  );
}

function InputRow({
  icon: Icon,
  label,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
  description,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  description?: string;
}) {
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-md border border-border bg-surface text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div>
            <label className="text-sm font-medium">{label}</label>
            {description ? (
              <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        <div className="relative min-w-[7rem]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className={cn(
              "block w-full rounded-md border border-border bg-background px-3 py-2 text-right text-sm outline-none focus:border-emerald-accent focus:ring-1 focus:ring-emerald-accent",
              prefix ? "pl-7" : "",
            )}
          />
          {suffix ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-5">
        <Slider
          value={[value]}
          onValueChange={([v]) => {
            if (typeof v === "number") onChange(v);
          }}
          min={min}
          max={max}
          step={step}
        />
      </div>
    </div>
  );
}

function ResultCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
