import { describe, expect, it } from "vitest";

import { encodeReportCsv } from "@/lib/reports/csv";
import type { ComplianceReport } from "@/lib/reports/types";

const report: ComplianceReport = {
  framework: "IMDA Agentic AI MGF v1.5",
  frameworkCode: "imda",
  organizationSlug: "acme-hk",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  sections: [
    {
      id: "accountability",
      title: "Accountability",
      status: "pass",
      metrics: [
        { key: "formula", label: "Formula", value: "=cmd|' /C calc!A1" },
        { key: "punctuation", label: "Punctuation", value: 'comma, quote " and newline\nvalue' },
      ],
      findings: ["Safe finding"],
    },
  ],
  exceptions: [],
};

describe("compliance report CSV", () => {
  it("quotes every cell and neutralizes formula/control prefixes", () => {
    const csv = encodeReportCsv(report);
    expect(csv.split("\r\n")[0]).toBe(
      '"framework","framework_code","organization_slug","period_start","period_end","section_id","section_title","status","metric_key","metric_label","value","finding"',
    );
    expect(csv).toContain("\"'=cmd|' /C calc!A1\"");
    expect(csv).toContain('"comma, quote "" and newline\nvalue"');
    expect(csv).not.toMatch(/(^|,)[=+@-]/m);
  });

  it("is deterministic for the same report", () => {
    expect(encodeReportCsv(report)).toBe(encodeReportCsv(structuredClone(report)));
  });
});
