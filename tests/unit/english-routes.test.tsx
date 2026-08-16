import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import AboutPage, { metadata as aboutMetadata } from "@/app/(marketing)/about/page";
import BenefitsPage, { metadata as benefitsMetadata } from "@/app/(marketing)/benefits/page";
import ComplianceStandardsPage, {
  metadata as complianceStandardsMetadata,
} from "@/app/(marketing)/compliance-standards/page";
import ContactPage, { metadata as contactMetadata } from "@/app/(marketing)/contact/page";
import FaqPage, { metadata as faqMetadata } from "@/app/(marketing)/faq/page";
import IndustriesPage, { metadata as industriesMetadata } from "@/app/(marketing)/industries/page";
import PricingPage, { metadata as pricingMetadata } from "@/app/(marketing)/pricing/page";
import ProductPage, { metadata as productMetadata } from "@/app/(marketing)/product/page";
import RoiCalculatorPage, {
  metadata as roiCalculatorMetadata,
} from "@/app/(marketing)/roi-calculator/page";
import SecurityPage, { metadata as securityMetadata } from "@/app/(marketing)/security/page";
import SolutionsPage, { metadata as solutionsMetadata } from "@/app/(marketing)/solutions/page";
import UseCasesPage, { metadata as useCasesMetadata } from "@/app/(marketing)/use-cases/page";
import HomePage, { metadata as homeMetadata } from "@/app/page";

type ExpectedMetadata = {
  title: string;
  description: string;
  openGraphTitle: string;
  openGraphDescription: string;
};

type EnglishRoute = {
  path: string;
  Page: ComponentType;
  metadata: unknown;
  expected: ExpectedMetadata;
};

const routes: EnglishRoute[] = [
  {
    path: "/",
    Page: HomePage,
    metadata: homeMetadata,
    expected: {
      title: "HermesPass — Know Your Agent Infrastructure for AI Agents",
      description:
        "HermesPass gives every enterprise AI agent a verifiable digital passport, a real-time policy gateway, scoped payment limits and a tamper-evident audit chain.",
      openGraphTitle: "HermesPass — Know Your Agent Infrastructure for AI Agents",
      openGraphDescription:
        "Issue verifiable agent passports, gate every tool call in real time, cap agent spend and export regulator-ready audit evidence.",
    },
  },
  {
    path: "/about",
    Page: AboutPage,
    metadata: aboutMetadata,
    expected: {
      title: "About HermesPass — The KYA Thesis for Agentic AI",
      description:
        "HermesPass builds Know Your Agent infrastructure: open-standard identity, real-time authority and provable audit for the agents now acting inside enterprises.",
      openGraphTitle: "About HermesPass — The KYA Thesis",
      openGraphDescription:
        "Why agent identity, authority and evidence need dedicated infrastructure, and how HermesPass approaches it with open standards.",
    },
  },
  {
    path: "/benefits",
    Page: BenefitsPage,
    metadata: benefitsMetadata,
    expected: {
      title: "Benefits — Why Enterprises Choose HermesPass for KYA",
      description:
        "Ship agents faster with less risk: verifiable agent identity, real-time authority limits, scoped spend and regulator-ready evidence produced automatically.",
      openGraphTitle: "Benefits of HermesPass — Know Your Agent Infrastructure",
      openGraphDescription:
        "Four controls in one enforcement point, and what makes HermesPass different from IAM, API gateways and application logging.",
    },
  },
  {
    path: "/compliance-standards",
    Page: ComplianceStandardsPage,
    metadata: complianceStandardsMetadata,
    expected: {
      title: "Compliance & Standards — IMDA, HKMA, W3C | HermesPass",
      description:
        "How HermesPass maps agent controls to IMDA Model AI Governance for GenAI, the HKMA GenA.I. Sandbox, PDPO/PDPA data handling and W3C DID/VC standards.",
      openGraphTitle: "HermesPass Compliance — Standards and Control Mapping",
      openGraphDescription:
        "Control mapping, evidence model and export formats for agent governance in Hong Kong and Singapore.",
    },
  },
  {
    path: "/contact",
    Page: ContactPage,
    metadata: contactMetadata,
    expected: {
      title: "Contact HermesPass — Book an Agent Governance Briefing",
      description:
        "Request a 30-minute HermesPass briefing: agent passport issuance, policy gateway, scoped spend limits and regulator-ready audit exports.",
      openGraphTitle: "Contact HermesPass — Book a Briefing",
      openGraphDescription:
        "Tell us about your agent estate and we'll map it onto HermesPass controls in one session.",
    },
  },
  {
    path: "/faq",
    Page: FaqPage,
    metadata: faqMetadata,
    expected: {
      title: "FAQ — HermesPass Agent Passports, Approvals & Reporting",
      description:
        "Answers on agent passports, human-in-the-loop approvals, spend controls, audit exports and regulator-ready reporting.",
      openGraphTitle: "HermesPass FAQ — Agent Governance, Approvals & Reporting",
      openGraphDescription:
        "How agent passports work, how human-in-the-loop approvals operate, and how compliance evidence is exported.",
    },
  },
  {
    path: "/industries",
    Page: IndustriesPage,
    metadata: industriesMetadata,
    expected: {
      title: "Industries — Agent Governance for Regulated Sectors",
      description:
        "HermesPass agent governance for financial services, insurance, commerce, ad tech, logistics, healthcare and professional services across Hong Kong and Singapore.",
      openGraphTitle: "HermesPass Industries — Agent Governance by Sector",
      openGraphDescription:
        "Sector-specific passports, thresholds, spend scopes and audit evidence built for the way each industry delegates authority.",
    },
  },
  {
    path: "/pricing",
    Page: PricingPage,
    metadata: pricingMetadata,
    expected: {
      title: "Pricing — Pilot, Growth and Enterprise Plans | HermesPass",
      description:
        "Indicative HermesPass plans by agent count, gateway volume and audit retention — from a governed pilot to enterprise-wide agent compliance.",
      openGraphTitle: "HermesPass Pricing — Pilot, Growth, Enterprise",
      openGraphDescription:
        "Plans scale with governed agents, gateway decision volume and audit retention. Talk to us for a scoped quote.",
    },
  },
  {
    path: "/product",
    Page: ProductPage,
    metadata: productMetadata,
    expected: {
      title: "Product — Agent Passports, Policy Gateway & Audit Chain",
      description:
        "Inside HermesPass: DID and Verifiable Credential issuance, a real-time ALLOW/DENY/HOLD policy gateway, scoped virtual-card spend limits and a tamper-evident audit chain.",
      openGraphTitle: "HermesPass Product — Identity, Authority, Spend, Evidence",
      openGraphDescription:
        "How HermesPass issues agent passports, gates every tool call, caps agent spend and produces exportable compliance evidence.",
    },
  },
  {
    path: "/roi-calculator",
    Page: RoiCalculatorPage,
    metadata: roiCalculatorMetadata,
    expected: {
      title: "ROI Calculator — HermesPass KYA Savings",
      description:
        "Estimate how much compliance review time and ungoverned agent spend HermesPass can save your enterprise.",
      openGraphTitle: "HermesPass ROI Calculator — Agent Governance Savings",
      openGraphDescription:
        "Estimate compliance review time saved and spend governance impact from Know Your Agent infrastructure.",
    },
  },
  {
    path: "/security",
    Page: SecurityPage,
    metadata: securityMetadata,
    expected: {
      title: "Trust Center — HermesPass Security & Compliance",
      description:
        "How HermesPass secures agent identity, authority and spend, what compliance artifacts we share under review, and how our hash-chain audit log works.",
      openGraphTitle: "HermesPass Trust Center — Security, Compliance, Audit Chain",
      openGraphDescription:
        "Our security posture, the artifacts we provide to enterprise reviewers, and a public explanation of tamper-evident hash-chain audit logging.",
    },
  },
  {
    path: "/solutions",
    Page: SolutionsPage,
    metadata: solutionsMetadata,
    expected: {
      title: "Solutions — Agent Governance by Industry | HermesPass",
      description:
        "How HermesPass removes agent risk for banks and insurers, commerce platforms, ad-tech agencies and procurement or BPO operations.",
      openGraphTitle: "HermesPass Solutions — Agent Governance by Industry",
      openGraphDescription:
        "Industry-specific agent controls: mandates for financial services, merchant-scoped purchasing, budget caps for ad-tech, and approval thresholds for procurement.",
    },
  },
  {
    path: "/use-cases",
    Page: UseCasesPage,
    metadata: useCasesMetadata,
    expected: {
      title: "Use Cases — Governed AI Agent Workflows | HermesPass",
      description:
        "Six production agent use cases governed end to end: autonomous purchasing, payment mandates, customer data access, claims triage, outbound comms and campaign budgets.",
      openGraphTitle: "HermesPass Use Cases — Governed AI Agent Workflows",
      openGraphDescription:
        "See exactly how a passport, a policy decision, a scoped wallet and a hash-linked audit record apply to each real agent workflow.",
    },
  },
];

describe("English marketing routes", () => {
  it.each(routes)("$path preserves its complete metadata", ({ metadata, expected }) => {
    expect(metadata).toEqual({
      title: expected.title,
      description: expected.description,
      openGraph: {
        title: expected.openGraphTitle,
        description: expected.openGraphDescription,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
      },
    });
  });

  it.each(routes)("$path renders inside the marketing shell", ({ path, Page }) => {
    navigation.pathname = path;
    render(<Page />);

    expect(screen.getAllByText("HermesPass").length).toBeGreaterThan(0);
    expect(document.querySelector("main")).toBeInTheDocument();
  });
});
