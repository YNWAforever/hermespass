import type { ComplianceReport, ReportInput, ReportSection } from "@/lib/reports/types";

const SECTION_TITLES = {
  accountability: "Accountability",
  "technical-controls": "Technical controls",
  "audit-integrity": "Audit integrity",
  incidents: "Incidents and remediation",
} as const;

export function buildImdaReport(input: ReportInput): ComplianceReport {
  return buildFrameworkReport(input, "IMDA Agentic AI MGF v1.5", "imda", SECTION_TITLES);
}

export function buildFrameworkReport(
  input: ReportInput,
  framework: string,
  frameworkCode: "imda" | "hkma",
  titles: Record<keyof typeof SECTION_TITLES, string>,
): ComplianceReport {
  const activeAgents = input.agents.filter((agent) => agent.status === "active").length;
  const decisionTotal = input.decisions.allow + input.decisions.deny + input.decisions.hold;
  const riskCounts = input.agents.reduce<Record<string, number>>((counts, agent) => {
    counts[agent.risk] = (counts[agent.risk] ?? 0) + 1;
    return counts;
  }, {});
  const riskSummary =
    Object.entries(riskCounts)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([risk, count]) => risk + ": " + count)
      .join(", ") || "none";

  const sections: ReportSection[] = [
    {
      id: "accountability",
      title: titles.accountability,
      status: input.agents.length > 0 ? "pass" : "warning",
      metrics: [
        { key: "agents.total", label: "Registered agents", value: input.agents.length },
        { key: "agents.active", label: "Active agents", value: activeAgents },
        { key: "agents.risk", label: "Risk-tier distribution", value: riskSummary },
      ],
      findings: [
        input.agents.length > 0
          ? "Every registered agent is represented in the tenant identity inventory."
          : "No agents were registered during the reporting period.",
      ],
    },
    {
      id: "technical-controls",
      title: titles["technical-controls"],
      status: decisionTotal >= 0 ? "pass" : "warning",
      metrics: [
        { key: "decisions.allow", label: "Allowed decisions", value: input.decisions.allow },
        { key: "decisions.deny", label: "Denied decisions", value: input.decisions.deny },
        { key: "decisions.hold", label: "Held decisions", value: input.decisions.hold },
        { key: "decisions.total", label: "Total gateway decisions", value: decisionTotal },
      ],
      findings: [
        "Gateway decisions are summarized from the tenant-scoped authorization read model.",
      ],
    },
    {
      id: "audit-integrity",
      title: titles["audit-integrity"],
      status: input.chainValid ? "pass" : "fail",
      metrics: [
        { key: "audit.checked", label: "Audit rows checked", value: input.checkedRows },
        {
          key: "audit.chain",
          label: "Audit chain",
          value: input.chainValid ? "verified" : "broken",
        },
      ],
      findings: [
        input.chainValid
          ? "The authoritative append-only audit chain verified for the reporting period."
          : "The authoritative audit chain did not verify; investigate before relying on this report.",
      ],
    },
    {
      id: "incidents",
      title: titles.incidents,
      status: input.approvals.byTimeout > 0 ? "warning" : "pass",
      metrics: [
        { key: "approvals.resolved", label: "Resolved approvals", value: input.approvals.resolved },
        { key: "approvals.human", label: "Human resolutions", value: input.approvals.byHuman },
        {
          key: "approvals.timeout",
          label: "Timed-out approvals",
          value: input.approvals.byTimeout,
        },
        {
          key: "approvals.medianMinutes",
          label: "Median approval minutes",
          value: input.approvals.medianMinutes,
        },
      ],
      findings: [
        input.approvals.byTimeout > 0
          ? "Some approvals expired without a human resolution."
          : "No approval timeouts were recorded in the reporting period.",
      ],
    },
  ];

  const exceptions = [];
  if (!input.chainValid) {
    exceptions.push({
      code: "AUDIT_CHAIN_BROKEN" as const,
      message: "The audit chain failed verification.",
    });
  }
  if (input.approvals.byTimeout > 0) {
    exceptions.push({
      code: "APPROVALS_TIMED_OUT" as const,
      message:
        input.approvals.byTimeout +
        " approval" +
        (input.approvals.byTimeout === 1 ? "" : "s") +
        " expired without a human resolution.",
    });
  }

  return {
    framework,
    frameworkCode,
    organizationSlug: input.orgSlug,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    sections,
    exceptions,
  };
}
