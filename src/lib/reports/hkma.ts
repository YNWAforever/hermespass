import { buildFrameworkReport } from "@/lib/reports/imda";
import type { ComplianceReport, ReportInput } from "@/lib/reports/types";

const SECTION_TITLES = {
  accountability: "Governance and accountability",
  "technical-controls": "Technology and control environment",
  "audit-integrity": "Audit trail and assurance",
  incidents: "Incidents and consumer safeguards",
} as const;

export function buildHkmaReport(input: ReportInput): ComplianceReport {
  return buildFrameworkReport(input, "HKMA GenA.I. Sandbox++", "hkma", SECTION_TITLES);
}
