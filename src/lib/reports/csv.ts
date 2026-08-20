import type { ComplianceReport } from "@/lib/reports/types";

const FORMULA_PREFIX = /^[\s\u0000-\u001f\u007f]*[=+\-@]/;

export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = FORMULA_PREFIX.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function encodeReportCsv(report: ComplianceReport): string {
  const headers = [
    "framework",
    "framework_code",
    "organization_slug",
    "period_start",
    "period_end",
    "section_id",
    "section_title",
    "status",
    "metric_key",
    "metric_label",
    "value",
    "finding",
  ];
  const rows: unknown[][] = [];
  for (const section of report.sections) {
    const metrics =
      section.metrics.length > 0 ? section.metrics : [{ key: "", label: "", value: "" }];
    for (const metric of metrics) {
      rows.push([
        report.framework,
        report.frameworkCode,
        report.organizationSlug,
        report.periodStart,
        report.periodEnd,
        section.id,
        section.title,
        section.status,
        metric.key,
        metric.label,
        metric.value,
        section.findings.join(" | "),
      ]);
    }
  }
  if (rows.length === 0) {
    rows.push([
      report.framework,
      report.frameworkCode,
      report.organizationSlug,
      report.periodStart,
      report.periodEnd,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  for (const exception of report.exceptions) {
    rows.push([
      report.framework,
      report.frameworkCode,
      report.organizationSlug,
      report.periodStart,
      report.periodEnd,
      "exceptions",
      "Exceptions",
      "warning",
      exception.code,
      exception.code,
      exception.message,
      "",
    ]);
  }
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
