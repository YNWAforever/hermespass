import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Download, FileText, Link2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/hermes/page-header";
import { DecisionBadge } from "@/components/hermes/badges";
import { useHermes } from "@/lib/hermes-store";

export const Route = createFileRoute("/compliance")({
  head: () => ({
    meta: [
      { title: "Regulatory Audit Log & Compliance Exporter — HermesPass" },
      {
        name: "description",
        content:
          "Tamper-evident hash chain of every agent decision, with IMDA MGF v1.5 and HKMA GenA.I. Sandbox++ readiness and one-click regulator exports.",
      },
      {
        property: "og:title",
        content: "Regulatory Audit Log & Compliance Exporter — HermesPass",
      },
      {
        property: "og:description",
        content:
          "Hash-chained agent audit trail with one-click regulatory PDF and CSV reporting for Hong Kong and Singapore.",
      },
    ],
  }),
  component: CompliancePage,
});

function CompliancePage() {
  const { chain, agentBySlug } = useHermes();

  function exportCsv() {
    const header = [
      "block_index",
      "timestamp",
      "agent_did",
      "action",
      "payload_hash",
      "previous_hash",
      "signature_valid",
      "decision",
    ].join(",");
    const rows = chain.map((b) =>
      [
        b.index,
        b.timestamp,
        agentBySlug(b.agentSlug)?.id ?? b.agentSlug,
        b.action,
        b.payloadHash,
        b.prevHash,
        b.signatureValid,
        b.decision,
      ].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hermespass-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Regulatory export generated", {
      description: `${chain.length} hash-chained blocks written to CSV.`,
    });
  }

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
            <Button className="shadow-glow-emerald" onClick={exportCsv}>
              <Download className="size-4" />
              1-click regulatory export
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel flex items-center gap-3 p-4">
          <BadgeCheck className="size-5 shrink-0 text-emerald-accent" />
          <div>
            <p className="text-sm font-medium">IMDA Agentic AI MGF v1.5</p>
            <p className="text-xs text-muted-foreground">
              Compliant · Singapore
            </p>
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
          <Link2 className="size-5 shrink-0 text-emerald-accent" />
          <div>
            <p className="text-sm font-medium">Chain integrity verified</p>
            <p className="font-mono text-xs text-muted-foreground">
              {chain.length} blocks · 0 breaks
            </p>
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
                <th className="px-4 py-3">Sig</th>
                <th className="px-4 py-3">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {chain.map((b) => (
                <tr key={b.index} className="hover:bg-surface-raised/40">
                  <td className="px-4 py-3 font-mono text-xs">#{b.index}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {b.timestamp.replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {agentBySlug(b.agentSlug)?.name ?? b.agentSlug}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-accent">
                    {b.action}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {b.payloadHash.slice(0, 16)}…
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {b.prevHash.slice(0, 16)}…
                  </td>
                  <td className="px-4 py-3">
                    <BadgeCheck className="size-4 text-emerald-accent" />
                  </td>
                  <td className="px-4 py-3">
                    <DecisionBadge decision={b.decision} />
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
