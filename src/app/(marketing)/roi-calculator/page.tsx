import type { Metadata } from "next";

import { EnRoiClient } from "@/components/marketing/en-roi-client";

export const metadata: Metadata = {
  title: "ROI Calculator — HermesPass KYA Savings",
  description:
    "Estimate how much compliance review time and ungoverned agent spend HermesPass can save your enterprise.",
  openGraph: {
    title: "HermesPass ROI Calculator — Agent Governance Savings",
    description:
      "Estimate compliance review time saved and spend governance impact from Know Your Agent infrastructure.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RoiCalculatorPage() {
  return <EnRoiClient />;
}
