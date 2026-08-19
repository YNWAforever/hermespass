import { describe, expect, it } from "vitest";

import { buildHkmaReport } from "@/lib/reports/hkma";
import { buildImdaReport } from "@/lib/reports/imda";
import type { ReportInput } from "@/lib/reports/types";

const input: ReportInput = {
  orgSlug: "acme-hk",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  chainValid: true,
  checkedRows: 8,
  agents: [
    { did: "did:web:hermespass.asia:agent:ops", name: "Ops", risk: "low", status: "active" },
    {
      did: "did:web:hermespass.asia:agent:review",
      name: "Review",
      risk: "high",
      status: "revoked",
    },
  ],
  decisions: { allow: 4, deny: 2, hold: 2 },
  approvals: { resolved: 3, byHuman: 2, byTimeout: 1, medianMinutes: 12 },
};

function section(report: ReturnType<typeof buildImdaReport>, id: string) {
  return report.sections.find((entry) => entry.id === id)!;
}

describe("pure compliance reports", () => {
  it("builds the IMDA framework with stable sections and evidence counts", () => {
    const report = buildImdaReport(input);
    expect(report.framework).toBe("IMDA Agentic AI MGF v1.5");
    expect(report.organizationSlug).toBe("acme-hk");
    expect(report.sections.map((entry) => entry.id)).toEqual([
      "accountability",
      "technical-controls",
      "audit-integrity",
      "incidents",
    ]);
    expect(section(report, "accountability").metrics).toEqual(
      expect.arrayContaining([
        { key: "agents.total", label: "Registered agents", value: 2 },
        { key: "agents.active", label: "Active agents", value: 1 },
      ]),
    );
    expect(section(report, "technical-controls").metrics).toEqual(
      expect.arrayContaining([
        { key: "decisions.allow", label: "Allowed decisions", value: 4 },
        { key: "decisions.deny", label: "Denied decisions", value: 2 },
        { key: "decisions.hold", label: "Held decisions", value: 2 },
      ]),
    );
    expect(section(report, "audit-integrity").metrics).toEqual(
      expect.arrayContaining([
        { key: "audit.checked", label: "Audit rows checked", value: 8 },
        { key: "audit.chain", label: "Audit chain", value: "verified" },
      ]),
    );
    expect(section(report, "incidents").metrics).toEqual(
      expect.arrayContaining([
        { key: "approvals.resolved", label: "Resolved approvals", value: 3 },
        { key: "approvals.human", label: "Human resolutions", value: 2 },
        { key: "approvals.timeout", label: "Timed-out approvals", value: 1 },
        { key: "approvals.medianMinutes", label: "Median approval minutes", value: 12 },
      ]),
    );
    expect(report.exceptions).toEqual([
      {
        code: "APPROVALS_TIMED_OUT",
        message: "1 approval expired without a human resolution.",
      },
    ]);
  });

  it("records broken-chain and timeout exceptions without claiming compliance", () => {
    const report = buildImdaReport({
      ...input,
      chainValid: false,
      checkedRows: 0,
      approvals: { ...input.approvals, byTimeout: 2 },
    });
    expect(report.sections.find((entry) => entry.id === "audit-integrity")?.status).toBe("fail");
    expect(report.exceptions).toEqual([
      { code: "AUDIT_CHAIN_BROKEN", message: "The audit chain failed verification." },
      {
        code: "APPROVALS_TIMED_OUT",
        message: "2 approvals expired without a human resolution.",
      },
    ]);
  });

  it("remaps section titles for HKMA while preserving evidence and determinism", () => {
    const first = buildHkmaReport(input);
    const second = buildHkmaReport(input);
    expect(first.framework).toBe("HKMA GenA.I. Sandbox++");
    expect(first.sections.map((entry) => entry.id)).toEqual([
      "accountability",
      "technical-controls",
      "audit-integrity",
      "incidents",
    ]);
    expect(first.sections.map((entry) => entry.title)).toEqual([
      "Governance and accountability",
      "Technology and control environment",
      "Audit trail and assurance",
      "Incidents and consumer safeguards",
    ]);
    expect(first).toEqual(second);
    expect(first.sections[1]?.metrics).toEqual(buildImdaReport(input).sections[1]?.metrics);
  });
});
