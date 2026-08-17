import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/hermes/app-shell";
import { AccessDenied } from "@/components/hermes/access-denied";
import { ActorProvider } from "@/components/auth/actor-context";
import { AgentFixtureProvider } from "@/lib/agents/fixture-context";
import { getCurrentActor } from "@/lib/auth/authorization";
import { isE2eUser } from "@/lib/auth/e2e-adapter";
import { getSessionUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");
  const actor = await getCurrentActor();
  if (!actor) return <AccessDenied />;
  return (
    <AgentFixtureProvider enabled={isE2eUser(actor.userId)}>
      <ActorProvider actor={actor}>
        <AppShell actor={actor}>{children}</AppShell>
      </ActorProvider>
    </AgentFixtureProvider>
  );
}
