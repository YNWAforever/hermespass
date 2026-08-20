import { describe, expect, it } from "vitest";

import AgentsPage, { metadata as agentsMetadata } from "@/app/dashboard/agents/page";
import ApprovalsPage, { metadata as approvalsMetadata } from "@/app/dashboard/approvals/page";
import CompliancePage, { metadata as complianceMetadata } from "@/app/dashboard/compliance/page";
import DashboardPage, { metadata as dashboardMetadata } from "@/app/dashboard/page";
import WalletsPage, { metadata as walletsMetadata } from "@/app/dashboard/wallets/page";
import { AgentsClient } from "@/components/hermes/dashboard/agents-client";
import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import { ComplianceClient } from "@/components/hermes/dashboard/compliance-client";
import { DashboardOverviewClient } from "@/components/hermes/dashboard/dashboard-overview-client";
import { WalletsClient } from "@/components/hermes/dashboard/wallets-client";

const dashboardRoutes = [
  {
    path: "/dashboard",
    Page: DashboardPage,
    Client: DashboardOverviewClient,
    metadata: dashboardMetadata,
    expected: {
      title: "HermesPass — Digital Passports & Compliance for AI Agents",
      description:
        "HermesPass is the KYA infrastructure for enterprise AI agents: issue verifiable passports, gate every tool call, and export regulator-ready audit trails.",
      openGraphDescription:
        "Know Your Agent infrastructure for Hong Kong and Singapore: verifiable credentials, policy gateway, scoped wallets and tamper-evident audit logs.",
    },
  },
  {
    path: "/dashboard/agents",
    Page: AgentsPage,
    Client: AgentsClient,
    metadata: agentsMetadata,
    expected: {
      title: "Agent Directory & KYA Passport Center — HermesPass",
      description:
        "Issue, inspect and revoke W3C Verifiable Credential passports for every AI agent operating in Hong Kong and Singapore.",
      openGraphDescription:
        "Digital passports for AI agents with cryptographic verification, risk tiers and scoped capabilities.",
    },
  },
  {
    path: "/dashboard/approvals",
    Page: ApprovalsPage,
    Client: ApprovalsClient,
    metadata: approvalsMetadata,
    expected: {
      title: "Live Policy Gateway & Human-in-the-Loop — HermesPass",
      description:
        "Watch agent tool calls resolve as allow, deny or hold in real time, and release or reject held actions from one review drawer.",
      openGraphDescription:
        "Real-time agent action stream with tri-state policy decisions and human approval gates.",
    },
  },
  {
    path: "/dashboard/compliance",
    Page: CompliancePage,
    Client: ComplianceClient,
    metadata: complianceMetadata,
    expected: {
      title: "Regulatory Audit Log & Compliance Exporter — HermesPass",
      description:
        "Tamper-evident hash chain of every agent decision, with IMDA MGF v1.5 and HKMA GenA.I. Sandbox++ readiness and one-click regulator exports.",
      openGraphDescription:
        "Hash-chained agent audit trail with one-click regulatory PDF and CSV reporting for Hong Kong and Singapore.",
    },
  },
  {
    path: "/dashboard/wallets",
    Page: WalletsPage,
    Client: WalletsClient,
    metadata: walletsMetadata,
    expected: {
      title: "Scoped Agent Wallets & Spend Limits — HermesPass",
      description:
        "Issue virtual cards bound to agent DIDs, then tune per-transaction, daily and monthly ceilings plus merchant category whitelists.",
      openGraphDescription:
        "Virtual cards with agent-scoped spend caps and MCC whitelists for autonomous payments.",
    },
  },
] as const;

describe("dashboard routes", () => {
  it.each(dashboardRoutes)("$path preserves its exact metadata", ({ metadata, expected }) => {
    expect(metadata).toEqual({
      title: expected.title,
      description: expected.description,
      openGraph: {
        title: expected.title,
        description: expected.openGraphDescription,
      },
    });
  });

  it.each(dashboardRoutes)("$path remains a thin server wrapper", ({ Page, Client }) => {
    expect(Page().type).toBe(Client);
  });
});
