import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { KeyRound, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/hermes/page-header";
import {
  RiskBadge,
  StatusBadge,
  VerifiedPill,
} from "@/components/hermes/badges";
import { useHermes } from "@/lib/hermes-store";
import {
  TOOL_SCOPES,
  credentialFor,
  formatHKD,
  type Agent,
  type RiskTier,
} from "@/lib/hermes-data";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Agent Directory & KYA Passport Center — HermesPass" },
      {
        name: "description",
        content:
          "Issue, inspect and revoke W3C Verifiable Credential passports for every AI agent operating in Hong Kong and Singapore.",
      },
      {
        property: "og:title",
        content: "Agent Directory & KYA Passport Center — HermesPass",
      },
      {
        property: "og:description",
        content:
          "Digital passports for AI agents with cryptographic verification, risk tiers and scoped capabilities.",
      },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { agents } = useHermes();
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<"all" | RiskTier>("all");

  const filtered = useMemo(
    () =>
      agents.filter((a) => {
        const matchesQuery = `${a.name} ${a.org} ${a.id}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return matchesQuery && (risk === "all" || a.risk === risk);
      }),
    [agents, query, risk],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Know Your Agent"
        title="Agent Directory & Passport Center"
        description="Every agent operating under your organisation carries a signed digital passport. Inspect its credential, capabilities and spend ceiling before it ever touches a tool."
        actions={<IssuePassportDialog />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by agent, DID or owner organisation"
            className="bg-surface pl-9"
          />
        </div>
        <Select value={risk} onValueChange={(v) => setRisk(v as typeof risk)}>
          <SelectTrigger className="w-48 bg-surface">
            <SelectValue placeholder="Risk tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk tiers</SelectItem>
            <SelectItem value="low">Low — support / read</SelectItem>
            <SelectItem value="medium">Medium — procurement</SelectItem>
            <SelectItem value="high">High — financial actions</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {filtered.map((agent, i) => (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i, 6) * 0.04 }}
          >
            <PassportCard agent={agent} />
          </motion.div>
        ))}
        {filtered.length === 0 ? (
          <p className="panel p-8 text-sm text-muted-foreground">
            No passports match this filter.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PassportCard({ agent }: { agent: Agent }) {
  return (
    <article className="panel grid-backdrop relative overflow-hidden p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            Agent Digital Passport · HK / SG
          </p>
          <h2 className="mt-1.5 truncate text-lg font-semibold">
            {agent.name}
          </h2>
          <p className="text-sm text-muted-foreground">{agent.role}</p>
        </div>
        <StatusBadge status={agent.status} />
      </div>

      <p className="mt-4 truncate rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs text-cyan-accent">
        {agent.id}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Owner organisation
          </dt>
          <dd className="mt-1 font-medium">{agent.org}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Spend ceiling
          </dt>
          <dd className="mt-1 font-mono font-medium">
            {agent.spendCap > 0 ? formatHKD(agent.spendCap) : "No payment scope"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Credential validity
          </dt>
          <dd className="mt-1 font-mono text-xs">
            {agent.issued} → {agent.expires}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Risk tier
          </dt>
          <dd className="mt-1">
            <RiskBadge risk={agent.risk} />
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {agent.scopes.map((s) => (
          <span
            key={s}
            className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {s}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        <VerifiedPill />
        <CredentialDialog agent={agent} />
      </div>
    </article>
  );
}

function CredentialDialog({ agent }: { agent: Agent }) {
  const credential = credentialFor(agent);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-surface-raised">
          <KeyRound className="size-4" />
          Inspect credential
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Decoded Verifiable Credential</DialogTitle>
          <DialogDescription>
            JSON-LD payload resolved from{" "}
            <span className="font-mono">/.well-known/did.json</span> and verified
            against the issuer key.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Public key (Ed25519 multibase)
            </p>
            <p className="mt-1 truncate font-mono text-xs text-cyan-accent">
              {agent.publicKey}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Key thumbprint (SHA-256)
            </p>
            <p className="mt-1 font-mono text-xs text-emerald-accent">
              {agent.thumbprint}
            </p>
          </div>
        </div>
        <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background/80 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {JSON.stringify(credential, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

function IssuePassportDialog() {
  const { issuePassport } = useHermes();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [org, setOrg] = useState("Hermes Holdings APAC");
  const [risk, setRisk] = useState<RiskTier>("low");
  const [scopes, setScopes] = useState<string[]>(["catalog.read"]);
  const [spendCap, setSpendCap] = useState("500");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!name.trim()) {
      toast.error("Agent name is required to mint a passport.");
      return;
    }
    const created = issuePassport({
      name: name.trim(),
      role: role.trim() || "Unscoped operator",
      org: org.trim(),
      risk,
      scopes,
      spendCap: Number(spendCap) || 0,
    });
    toast.success("Passport issued", {
      description: `${created.id} — Ed25519 key sealed in vault.`,
    });
    setOpen(false);
    setName("");
    setRole("");
    setNotes("");
    setScopes(["catalog.read"]);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shadow-glow-emerald">
          <Plus className="size-4" />
          Issue new agent passport
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-emerald-accent" />
            Issue agent passport
          </DialogTitle>
          <DialogDescription>
            Generates an Ed25519 key pair, seals the private key, and signs a
            W3C Verifiable Credential bound to your organisation DID.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">Agent name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Kinnso Returns Agent"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-role">Role</Label>
              <Input
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Customer support"
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-org">Owner organisation</Label>
              <Input
                id="agent-org"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Risk tier</Label>
              <Select value={risk} onValueChange={(v) => setRisk(v as RiskTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low — customer support</SelectItem>
                  <SelectItem value="medium">Medium — procurement</SelectItem>
                  <SelectItem value="high">
                    High — financial actions
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tool scopes</Label>
            <div className="grid gap-2 rounded-lg border border-border bg-background/50 p-3 sm:grid-cols-2">
              {TOOL_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 font-mono text-xs text-muted-foreground"
                >
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(checked) =>
                      setScopes((prev) =>
                        checked
                          ? [...prev, scope]
                          : prev.filter((s) => s !== scope),
                      )
                    }
                  />
                  {scope}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-cap">Spend cap (HKD, per transaction)</Label>
            <Input
              id="agent-cap"
              type="number"
              min={0}
              value={spendCap}
              onChange={(e) => setSpendCap(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-notes">Governance notes (optional)</Label>
            <Textarea
              id="agent-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Human-in-the-loop owner, escalation channel, review cadence…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} className="shadow-glow-emerald">
            Mint passport
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
