import type { Metadata } from "next";

import { EnContactClient } from "@/components/marketing/en-contact-client";

export const metadata: Metadata = {
  title: "Contact HermesPass — Book an Agent Governance Briefing",
  description:
    "Request a 30-minute HermesPass briefing: agent passport issuance, policy gateway, scoped spend limits and regulator-ready audit exports.",
  openGraph: {
    title: "Contact HermesPass — Book a Briefing",
    description:
      "Tell us about your agent estate and we'll map it onto HermesPass controls in one session.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function ContactPage() {
  return <EnContactClient />;
}
