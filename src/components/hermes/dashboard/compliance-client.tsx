"use client";

import { BadgeCheck, Download, FileText, Link2, ShieldCheck } from "lucide-react";

import { DecisionBadge } from "@/components/hermes/badges";
import { PageHeader } from "@/components/hermes/page-header";
import { Button } from "@/components/ui/button";
import { useAgents, useAudit, useAuditVerification } from "@/lib/agents/client";

export function ComplianceClient() {
  const { data } = useAudit();
  const verification = useAuditVerification();
  const { data: agentData } = useAgents();
  const chain = data?.entries ?? [];
  const agents = agentData?.agents ?? [];

  function agentName(slug: string | null) {
    if (!slug) return "Unknown agent";
    return agents.find((agent) => agent.slug === slug)?.name ?? slug;
  }

  const verificationTitle = verification.isLoading
    ? "Verifying chain integrity…"
    : verification.isError
      ? "Unable to verify chain integrity"
      : verification.data?.valid
        ? "Chain integrity verified"
        : "Chain integrity broken";
  const verificationDetail = verification.isLoading
    ? "Checking the authoritative database chain"
    : verification.isError
      ? "Verification endpoint unavailable"
      : verification.data?.valid
        ? `${verification.data.checked} ${verification.data.checked === 1 ? "block" : "blocks"} · 0 breaks`
        : verification.data?.firstInvalid == null
          ? "Verification failed before a block could be identified"
          : `First invalid block: #${verification.data.firstInvalid}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Audit & compliance"
        title="Regulatory audit log & exporter"
        description="Every gateway decision is appended to an append-only hash chain. Each block seals the previous hash, so any retroactive edit breaks verification."
        actions={
          <>
            <Button variant="outline" className="bg-surface" onClick={() => window.print()}>
              <FileText className="size-4" />
              PDF report
            </Button>
            <Button asChild variant="outline" className="bg-surface">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/reports/compliance?framework=imda&format=csv&periodStart=2026-01-01&periodEnd=2026-12-31">
                <Download className="size-4" />
                Export IMDA report
              </a>
            </Button>
            <Button asChild variant="outline" className="bg-surface">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/reports/compliance?framework=hkma&format=csv&periodStart=2026-01-01&periodEnd=2026-12-31">
                <Download className="size-4" />
                Export HKMA report
              </a>
            </Button>
            <Button asChild className="shadow-glow-emerald">
              <a href="/api/audit/export.csv">
                <Download className="size-4" />
                1-click regulatory export
              </a>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel flex items-center gap-3 p-4">
          <BadgeCheck className="size-5 shrink-0 text-emerald-accent" />
          <div>
            <p className="text-sm font-medium">IMDA Agentic AI MGF v1.5</p>
            <p className="text-xs text-muted-foreground">Compliant · Singapore</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <ShieldCheck className="size-5 shrink-0 text-cyan-accent" />
          <div>
            <p className="text-sm font-medium">HKMA GenA.I. Sandbox++</p>
            <p className="text-xs text-muted-foreground">Ready · Hong Kong</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <Link2
            className={`size-5 shrink-0 ${verification.data?.valid ? "text-emerald-accent" : "text-muted-foreground"}`}
          />
          <div>
            <p className="text-sm font-medium">{verificationTitle}</p>
            <p className="font-mono text-xs text-muted-foreground">{verificationDetail}</p>
          </div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-5xl text-left text-sm">
            <thead className="border-b border-border bg-surface-raised/60">
              <tr className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                <th className="px-4 py-3">Block</th>
                <th className="px-4 py-3">Timestamp (UTC)</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Payload hash</th>
                <th className="px-4 py-3">Previous hash</th>
                <th className="px-4 py-3">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {chain.map((block) => (
                <tr key={block.id} className="hover:bg-surface-raised/40">
                  <td className="px-4 py-3 font-mono text-xs">#{block.id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {block.timestamp.replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-4 py-3 text-xs">{agentName(block.agentSlug)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-accent">{block.action}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {block.payloadHash.slice(0, 16)}…
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {block.previousHash.slice(0, 16)}…
                  </td>
                  <td className="px-4 py-3">
                    {block.decision ? <DecisionBadge decision={block.decision} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
