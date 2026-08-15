import { Calculator, Clock, DollarSign, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { localize, useLocale } from "@/lib/i18n/locale";
import { ZH_ROI } from "@/lib/i18n/zh-content";
import {
  ZhCtaBand,
  ZhHeading,
  ZhSection as Wrap,
  ZhShell,
} from "@/components/marketing/zh-shell";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

const LABOUR_TIME_REDUCTION = 0.8;
const SPEND_CAPTURE_RATE = 0.6;

function currency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ZhRoiPage() {
  const locale = useLocale();
  const t = localize(ZH_ROI, locale);

  const [agents, setAgents] = useState(25);
  const [reviewsPerAgent, setReviewsPerAgent] = useState(2);
  const [hoursPerReview, setHoursPerReview] = useState(4);
  const [hourlyRate, setHourlyRate] = useState(180);
  const [monthlySpend, setMonthlySpend] = useState(50000);
  const [outOfPolicyRate, setOutOfPolicyRate] = useState(4);

  const results = useMemo(() => {
    const monthlyReviewHours = agents * reviewsPerAgent * hoursPerReview;
    const monthlyComplianceCost = monthlyReviewHours * hourlyRate;
    const labourSaved = monthlyComplianceCost * LABOUR_TIME_REDUCTION;
    const spendGovernanceValue =
      monthlySpend * (outOfPolicyRate / 100) * SPEND_CAPTURE_RATE;
    const annualHours = monthlyReviewHours * LABOUR_TIME_REDUCTION * 12;
    return {
      annualHours,
      annualLabour: labourSaved * 12,
      annualSpend: spendGovernanceValue * 12,
      annualTotal: (labourSaved + spendGovernanceValue) * 12,
    };
  }, [agents, reviewsPerAgent, hoursPerReview, hourlyRate, monthlySpend, outOfPolicyRate]);

  return (
    <ZhShell>
      <Wrap className="grid-backdrop border-b border-border">
        <ZhHeading
          eyebrow={t.hero.eyebrow}
          title={t.hero.title}
          description={t.hero.description}
        />
      </Wrap>

      <Wrap>
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="panel divide-y divide-border p-0">
              <InputRow
                icon={ShieldCheck}
                field={t.inputs.agents}
                value={agents}
                onChange={setAgents}
                min={1}
                max={500}
                step={1}
              />
              <InputRow
                icon={ShieldCheck}
                field={t.inputs.reviews}
                value={reviewsPerAgent}
                onChange={setReviewsPerAgent}
                min={0}
                max={20}
                step={1}
              />
              <InputRow
                icon={Clock}
                field={t.inputs.hoursPerReview}
                value={hoursPerReview}
                onChange={setHoursPerReview}
                min={0.5}
                max={24}
                step={0.5}
              />
              <InputRow
                icon={DollarSign}
                field={t.inputs.hourlyRate}
                value={hourlyRate}
                onChange={setHourlyRate}
                min={50}
                max={500}
                step={10}
              />
              <InputRow
                icon={DollarSign}
                field={t.inputs.monthlySpend}
                value={monthlySpend}
                onChange={setMonthlySpend}
                min={1000}
                max={500000}
                step={1000}
              />
              <InputRow
                icon={DollarSign}
                field={t.inputs.outOfPolicy}
                value={outOfPolicyRate}
                onChange={setOutOfPolicyRate}
                min={0}
                max={25}
                step={0.5}
              />
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="panel sticky top-24">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 text-emerald-accent">
                  <Calculator className="size-5" />
                </span>
                <h2 className="text-lg font-semibold">{t.results.heading}</h2>
              </div>

              <div className="mt-6 grid gap-4">
                <ResultCard
                  label={t.results.timeSaved.label}
                  value={`${Math.round(results.annualHours).toLocaleString()}${t.results.hoursUnit}`}
                  hint={t.results.timeSaved.hint}
                />
                <ResultCard
                  label={t.results.labour.label}
                  value={currency(results.annualLabour)}
                  hint={t.results.labour.hint}
                />
                <ResultCard
                  label={t.results.spend.label}
                  value={currency(results.annualSpend)}
                  hint={t.results.spend.hint}
                />
                <div className="rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 p-5">
                  <p className="font-mono text-[11px] tracking-wider text-emerald-accent uppercase">
                    {t.results.total}
                  </p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-accent">
                    {currency(results.annualTotal)}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-md border border-border bg-surface p-4">
                <p className="text-sm font-medium">
                  {t.results.assumptionsTitle}
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  {t.results.assumptions.map((a) => (
                    <li key={a}>• {a}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Wrap>

      <ZhCtaBand title={t.cta.title} description={t.cta.description} />
    </ZhShell>
  );
}

function InputRow({
  icon: Icon,
  field,
  value,
  onChange,
  min,
  max,
  step,
}: {
  icon: React.ElementType;
  field: { label: string; description?: string; prefix?: string; suffix?: string };
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div>
            <label className="text-sm font-medium">{field.label}</label>
            {field.description ? (
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                {field.description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="relative min-w-[8rem]">
          {field.prefix ? (
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
              {field.prefix}
            </span>
          ) : null}
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className={cn(
              "block w-full rounded-md border border-border bg-background px-3 py-2 text-right text-sm outline-none focus:border-emerald-accent focus:ring-1 focus:ring-emerald-accent",
              field.prefix ? "pl-7" : "",
            )}
          />
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
      <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
