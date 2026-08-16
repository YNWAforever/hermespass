import type { Metadata } from "next";

import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";

export const metadata: Metadata = {
  title: "Live Policy Gateway & Human-in-the-Loop — HermesPass",
  description:
    "Watch agent tool calls resolve as allow, deny or hold in real time, and release or reject held actions from one review drawer.",
  openGraph: {
    title: "Live Policy Gateway & Human-in-the-Loop — HermesPass",
    description:
      "Real-time agent action stream with tri-state policy decisions and human approval gates.",
  },
};

export default function ApprovalsPage() {
  return <ApprovalsClient />;
}
