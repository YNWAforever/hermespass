import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in — HermesPass",
  description: "Sign in to the HermesPass agent governance control plane.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next =
    params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/dashboard";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <section className="panel w-full max-w-md p-7">
        <p className="font-mono text-[10px] tracking-[0.24em] text-emerald-accent uppercase">
          HermesPass control plane
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Access is limited to provisioned organization members.
        </p>
        <div className="mt-6">
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
