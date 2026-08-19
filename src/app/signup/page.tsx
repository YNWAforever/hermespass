import type { Metadata } from "next";

import { SignupForm } from "@/components/auth/signup-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create your workspace — HermesPass",
  description: "Create a HermesPass workspace for governed AI agents.",
};

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <section className="panel w-full max-w-md p-7">
        <p className="font-mono text-[10px] tracking-[0.24em] text-emerald-accent uppercase">
          HermesPass control plane
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Create your workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You become the owner. Invite teammates after the workspace is created.
        </p>
        <div className="mt-6">
          <SignupForm />
        </div>
      </section>
    </main>
  );
}
