import type { Metadata } from "next";

import { InviteAcceptForm } from "@/components/auth/invite-accept-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept invitation — HermesPass",
  description: "Join a HermesPass organization invitation.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <section className="panel w-full max-w-md p-7">
        <p className="font-mono text-[10px] tracking-[0.24em] text-emerald-accent uppercase">
          HermesPass control plane
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Join your team</h1>
        <div className="mt-6">
          <InviteAcceptForm token={token} />
        </div>
      </section>
    </main>
  );
}
