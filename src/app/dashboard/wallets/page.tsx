import type { Metadata } from "next";

import { WalletsClient } from "@/components/hermes/dashboard/wallets-client";

export const metadata: Metadata = {
  title: "Scoped Agent Wallets & Spend Limits — HermesPass",
  description:
    "Issue virtual cards bound to agent DIDs, then tune per-transaction, daily and monthly ceilings plus merchant category whitelists.",
  openGraph: {
    title: "Scoped Agent Wallets & Spend Limits — HermesPass",
    description:
      "Virtual cards with agent-scoped spend caps and MCC whitelists for autonomous payments.",
  },
};

export default function WalletsPage() {
  return <WalletsClient />;
}
