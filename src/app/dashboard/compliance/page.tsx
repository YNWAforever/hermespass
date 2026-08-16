import type { Metadata } from "next";

import { ComplianceClient } from "@/components/hermes/dashboard/compliance-client";

export const metadata: Metadata = {
  title: "Regulatory Audit Log & Compliance Exporter — HermesPass",
  description:
    "Tamper-evident hash chain of every agent decision, with IMDA MGF v1.5 and HKMA GenA.I. Sandbox++ readiness and one-click regulator exports.",
  openGraph: {
    title: "Regulatory Audit Log & Compliance Exporter — HermesPass",
    description:
      "Hash-chained agent audit trail with one-click regulatory PDF and CSV reporting for Hong Kong and Singapore.",
  },
};

export default function CompliancePage() {
  return <ComplianceClient />;
}
