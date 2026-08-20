import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicAgent, verifyPublicAgent } from "@/lib/agents/service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const agent = await getPublicAgent(slug);
  return {
    title: agent ? `${agent.name} — HermesPass Agent Passport` : "Agent Passport — HermesPass",
  };
}

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getPublicAgent(slug);
  if (!agent) notFound();
  const verification = await verifyPublicAgent(slug);
  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <article className="panel mx-auto max-w-3xl p-8">
        <p className="font-mono text-[10px] tracking-[0.24em] text-emerald-accent uppercase">
          Public agent passport
        </p>
        <h1 className="mt-3 text-3xl font-semibold">{agent.name}</h1>
        <p className="mt-1 text-muted-foreground">
          {agent.role} · {agent.organization_name}
        </p>
        <p className="mt-6 break-all rounded-lg border border-border bg-surface-raised p-3 font-mono text-xs text-cyan-accent">
          {agent.did}
        </p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="mt-1 font-medium">{verification?.status ?? agent.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Risk tier</dt>
            <dd className="mt-1 font-medium">{agent.risk}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Valid until</dt>
            <dd className="mt-1 font-mono text-xs">
              {new Date(agent.expires_at).toISOString().slice(0, 10)}
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          {agent.scopes.map((scope) => (
            <span
              key={scope}
              className="rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground"
            >
              {scope}
            </span>
          ))}
        </div>
      </article>
    </main>
  );
}
