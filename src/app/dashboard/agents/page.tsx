import type { Metadata } from "next";

import { AgentsClient } from "@/components/hermes/dashboard/agents-client";

export const metadata: Metadata = {
  title: "Agent Directory & KYA Passport Center — HermesPass",
  description:
    "Issue, inspect and revoke W3C Verifiable Credential passports for every AI agent operating in Hong Kong and Singapore.",
  openGraph: {
    title: "Agent Directory & KYA Passport Center — HermesPass",
    description:
      "Digital passports for AI agents with cryptographic verification, risk tiers and scoped capabilities.",
  },
};

export default function AgentsPage() {
  return <AgentsClient />;
}
