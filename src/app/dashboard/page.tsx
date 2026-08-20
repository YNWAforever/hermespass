import type { Metadata } from "next";

import { DashboardOverviewClient } from "@/components/hermes/dashboard/dashboard-overview-client";

export const metadata: Metadata = {
  title: "HermesPass — Digital Passports & Compliance for AI Agents",
  description:
    "HermesPass is the KYA infrastructure for enterprise AI agents: issue verifiable passports, gate every tool call, and export regulator-ready audit trails.",
  openGraph: {
    title: "HermesPass — Digital Passports & Compliance for AI Agents",
    description:
      "Know Your Agent infrastructure for Hong Kong and Singapore: verifiable credentials, policy gateway, scoped wallets and tamper-evident audit logs.",
  },
};

export default function DashboardPage() {
  return <DashboardOverviewClient />;
}
