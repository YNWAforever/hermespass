import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, Ban, Fingerprint, ShieldAlert, Zap } from "lucide-react";
import { PageHeader } from "@/components/hermes/page-header";
import { DecisionBadge } from "@/components/hermes/badges";
import { useHermes } from "@/lib/hermes-store";
import { DECISION_TREND, formatHKD } from "@/lib/hermes-data";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "HermesPass — Digital Passports & Compliance for AI Agents" },
      {
        name: "description",
        content:
          "HermesPass is the KYA infrastructure for enterprise AI agents: issue verifiable passports, gate every tool call, and export regulator-ready audit trails.",
      },
      {
        property: "og:title",
        content: "HermesPass — Digital Passports & Compliance for AI Agents",
      },
      {
        property: "og:description",
        content:
          "Know Your Agent infrastructure for Hong Kong and Singapore: verifiable credentials, policy gateway, scoped wallets and tamper-evident audit logs.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { agents, events, wallets } = useHermes();
  const holds = events.filter((e) => e.decision === "hold").length;
  const denied = events.filter((e) => e.decision === "deny");
  const blockedSpend = denied.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const monthSpend = wallets.reduce((s, w) => s + w.spentThisMonth, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Control plane"
        title="Agent governance overview"
        description="A single control plane for the identity, authority and spend of every AI agent operating across your Hong Kong and Singapore entities."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Fingerprint}
          label="Active passports"
          value={String(agents.filter((a) => a.status === "active").length)}
          detail={`${agents.length} registered agents`}
        />
        <Kpi
          icon={Zap}
          label="Actions gated today"
          value={events.length.toLocaleString()}
          detail="signature-verified tool calls"
        />
        <Kpi
          icon={ShieldAlert}
          label="Holds pending review"
          value={String(holds)}
          detail="awaiting human mandate"
          tone="warn"
        />
        <Kpi
          icon={Ban}
          label="Blocked spend"
          value={formatHKD(blockedSpend)}
          detail={`${denied.length} denied payment mandates`}
          tone="danger"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Decision mix — last 18h</h2>
              <p className="text-xs text-muted-foreground">
                Allow / hold / deny volume across the policy gateway
              </p>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatHKD(monthSpend)} agent spend MTD
            </span>
          </div>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={DECISION_TREND}>
                <defs>
                  {[
                    ["allow", "var(--color-chart-1)"],
                    ["hold", "var(--color-chart-3)"],
                    ["deny", "var(--color-chart-4)"],
                  ].map(([key, color]) => (
                    <linearGradient
                      key={key}
                      id={`fill-${key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="hour"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="allow"
                  stroke="var(--color-chart-1)"
                  fill="url(#fill-allow)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="hold"
                  stroke="var(--color-chart-3)"
                  fill="url(#fill-hold)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="deny"
                  stroke="var(--color-chart-4)"
                  fill="url(#fill-deny)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel flex flex-col p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent gateway activity</h2>
            <Link
              to="/dashboard/approvals"
              className="inline-flex items-center gap-1 text-xs text-cyan-accent hover:underline"
            >
              Open gateway <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {events.slice(0, 6).map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-cyan-accent">
                    {e.tool}
                  </span>
                  <DecisionBadge decision={e.decision} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{e.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warn" | "danger";
}) {
  const toneCls =
    tone === "warn"
      ? "text-risk-medium"
      : tone === "danger"
        ? "text-risk-high"
        : "text-emerald-accent";
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <Icon className={`size-4 ${toneCls}`} />
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
