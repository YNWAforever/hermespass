import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Pause, Play, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageHeader } from "@/components/hermes/page-header";
import { DecisionBadge, RiskBadge } from "@/components/hermes/badges";
import { useHermes } from "@/lib/hermes-store";
import { formatHKD, type Decision, type GatewayEvent } from "@/lib/hermes-data";

export const Route = createFileRoute("/approvals")({
  head: () => ({
    meta: [
      { title: "Live Policy Gateway & Human-in-the-Loop — HermesPass" },
      {
        name: "description",
        content:
          "Watch agent tool calls resolve as allow, deny or hold in real time, and release or reject held actions from one review drawer.",
      },
      {
        property: "og:title",
        content: "Live Policy Gateway & Human-in-the-Loop — HermesPass",
      },
      {
        property: "og:description",
        content:
          "Real-time agent action stream with tri-state policy decisions and human approval gates.",
      },
    ],
  }),
  component: ApprovalsPage,
});

function timeOf(ts: string) {
  return new Date(ts).toISOString().slice(11, 19) + "Z";
}

function ApprovalsPage() {
  const { events, streaming, setStreaming, agentBySlug } = useHermes();
  const [filter, setFilter] = useState<"all" | Decision>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      events.filter((e) => filter === "all" || e.decision === filter).slice(0, 40),
    [events, filter],
  );
  const active = events.find((e) => e.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Policy gateway"
        title="Live gateway & human-in-the-loop hub"
        description="Every agent tool call is intercepted, signature-verified and evaluated against scoped policy. Held actions wait here for a human mandate."
        actions={
          <Button
            variant="outline"
            className="bg-surface"
            onClick={() => setStreaming(!streaming)}
          >
            {streaming ? (
              <>
                <Pause className="size-4" /> Pause stream
              </>
            ) : (
              <>
                <Play className="size-4" /> Resume stream
              </>
            )}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {(["allow", "hold", "deny"] as Decision[]).map((d) => (
          <div key={d} className="panel p-4">
            <DecisionBadge decision={d} />
            <p className="mt-3 font-mono text-2xl font-semibold">
              {events.filter((e) => e.decision === d).length}
            </p>
            <p className="text-xs text-muted-foreground">
              {d === "allow"
                ? "auto-executed calls in window"
                : d === "hold"
                  ? "awaiting human mandate"
                  : "blocked by policy engine"}
            </p>
          </div>
        ))}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList className="bg-surface">
          <TabsTrigger value="all">All traffic</TabsTrigger>
          <TabsTrigger value="hold">Holds</TabsTrigger>
          <TabsTrigger value="deny">Denied</TabsTrigger>
          <TabsTrigger value="allow">Allowed</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="panel divide-y divide-border overflow-hidden">
        <AnimatePresence initial={false}>
          {visible.map((event) => {
            const agent = agentBySlug(event.agentSlug);
            return (
              <motion.button
                key={event.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                onClick={() => setSelected(event.id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-raised/70"
              >
                <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {timeOf(event.timestamp)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {agent?.name ?? event.agentSlug}
                    </span>
                    <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-cyan-accent">
                      {event.tool}
                    </span>
                    {event.escalated ? (
                      <span className="rounded-full border border-cyan-accent/40 bg-cyan-accent/10 px-2 py-0.5 text-[10px] text-cyan-accent">
                        escalated · telegram
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {event.summary}
                  </span>
                </span>
                <DecisionBadge decision={event.decision} />
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      <ReviewDrawer event={active} onClose={() => setSelected(null)} />
    </div>
  );
}

function ReviewDrawer({
  event,
  onClose,
}: {
  event: GatewayEvent | null;
  onClose: () => void;
}) {
  const { agentBySlug, resolveEvent, escalateEvent } = useHermes();
  const agent = event ? agentBySlug(event.agentSlug) : undefined;

  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {event ? (
          <>
            <SheetHeader>
              <SheetTitle>Human review</SheetTitle>
              <SheetDescription>
                Request {event.id} intercepted by the policy proxy at{" "}
                {timeOf(event.timestamp)}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <div className="rounded-lg border border-border bg-background/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    {agent?.name ?? event.agentSlug}
                  </p>
                  {agent ? <RiskBadge risk={agent.risk} /> : null}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-cyan-accent">
                  {agent?.id}
                </p>
              </div>

              <div>
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  Requested action
                </p>
                <p className="mt-1 text-sm">{event.summary}</p>
                {event.amount ? (
                  <p className="mt-1 font-mono text-lg font-semibold text-risk-medium">
                    {formatHKD(event.amount)}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  Policy evaluation
                </p>
                <p className="mt-1 flex items-center gap-2">
                  <DecisionBadge decision={event.decision} />
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {event.reason}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-background/60 p-4">
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  Signature check
                </p>
                <p className="mt-1 font-mono text-xs text-emerald-accent">
                  Ed25519 verified · agent key #key-1
                </p>
                <p className="mt-2 font-mono text-[11px] break-all text-muted-foreground">
                  mandate: AP2/user-agent · tool {event.tool}
                </p>
              </div>

              {event.resolvedBy ? (
                <p className="rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 p-3 text-xs text-emerald-accent">
                  Resolved by {event.resolvedBy}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  className="flex-1 shadow-glow-emerald"
                  disabled={event.decision !== "hold"}
                  onClick={() => {
                    resolveEvent(event.id, "allow");
                    toast.success("Action approved", {
                      description: "Mandate re-signed and forwarded to the tool.",
                    });
                    onClose();
                  }}
                >
                  <Check className="size-4" />
                  Approve action
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={event.decision !== "hold"}
                  onClick={() => {
                    resolveEvent(event.id, "deny");
                    toast.error("Action rejected", {
                      description: "Mandate voided and logged to the hash chain.",
                    });
                    onClose();
                  }}
                >
                  <X className="size-4" />
                  Reject action
                </Button>
                <Button
                  variant="outline"
                  className="w-full bg-surface"
                  onClick={() => {
                    escalateEvent(event.id);
                    toast("Escalated to Telegram", {
                      description: "Approval gate sent to the compliance channel.",
                    });
                  }}
                >
                  <Send className="size-4" />
                  Escalate to Telegram
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
