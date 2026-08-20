export type ReportFramework = "imda" | "hkma";
export type ReportSectionId =
  "accountability" | "technical-controls" | "audit-integrity" | "incidents";
export type ReportStatus = "pass" | "warning" | "fail";

export type ReportInput = {
  orgSlug: string;
  periodStart: string;
  periodEnd: string;
  chainValid: boolean;
  checkedRows: number;
  agents: Array<{ did: string; name: string; risk: string; status: string }>;
  decisions: { allow: number; deny: number; hold: number };
  approvals: {
    resolved: number;
    byHuman: number;
    byTimeout: number;
    medianMinutes: number;
  };
};

export type ReportMetric = {
  key: string;
  label: string;
  value: string | number;
};

export type ReportSection = {
  id: ReportSectionId;
  title: string;
  status: ReportStatus;
  metrics: ReportMetric[];
  findings: string[];
};

export type ReportException = {
  code: "AUDIT_CHAIN_BROKEN" | "APPROVALS_TIMED_OUT";
  message: string;
};

export type ComplianceReport = {
  framework: string;
  frameworkCode: ReportFramework;
  organizationSlug: string;
  periodStart: string;
  periodEnd: string;
  sections: ReportSection[];
  exceptions: ReportException[];
};
