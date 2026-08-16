import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/hermes/app-shell";
import { AccessDenied } from "@/components/hermes/access-denied";
import { ActorProvider } from "@/components/auth/actor-context";
import { getCurrentActor } from "@/lib/auth/authorization";
import { getSessionUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");
  const actor = await getCurrentActor();
  if (!actor) return <AccessDenied />;
  return (
    <ActorProvider actor={actor}>
      <AppShell actor={actor}>{children}</AppShell>
    </ActorProvider>
  );
}
