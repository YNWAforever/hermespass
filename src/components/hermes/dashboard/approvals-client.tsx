"use client";

import { Check, Pause, Play, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useActor } from "@/components/auth/actor-context";
import { DecisionBadge, RiskBadge } from "@/components/hermes/badges";
import { PageHeader } from "@/components/hermes/page-header";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgents } from "@/lib/agents/client";
import type { AgentDto } from "@/lib/agents/types";
import { useApprovals, useResolveApproval } from "@/lib/approvals/client";
import type { ApprovalDecision, ApprovalDto, TelegramDeliveryState } from "@/lib/approvals/service";
import { useGatewayActivity } from "@/lib/gateway/client";
import type { GatewayActivityDecision, GatewayActivityItem } from "@/lib/gateway/activity-types";
import { mockAgentBySlug } from "@/lib/hermes-data";
import { useHermes } from "@/lib/hermes-store";

function timeOf(timestamp: string) {
  return new Date(timestamp).toISOString().slice(11, 19) + "Z";
}

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString("en-HK", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  });
}

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(amountCents / 100);
}

function reviewerLabel(event: GatewayActivityItem, approval: ApprovalDto | undefined) {
  const name = approval?.assignedReviewerName ?? event.assignedReviewerName;
  const email = approval?.assignedReviewerEmail ?? event.assignedReviewerEmail;
  return [name, email].filter(Boolean).join(" · ") || "Reviewer unavailable";
}

function telegramLabel(state: TelegramDeliveryState | null) {
  if (state === "sent") return "Telegram sent";
  if (state === "pending") return "Telegram pending";
  if (state === "failed") return "Telegram failed";
  return "Telegram not requested";
}

function resolutionLabel(event: GatewayActivityItem, approval: ApprovalDto) {
  if (approval.status === "expired") return "Approval expired without authorization";
  const outcome = approval.status === "approved" ? "Approved" : "Denied";
  if (approval.resolutionSource === "owner_override") {
    return `${outcome} by organization owner override`;
  }
  if (approval.resolutionSource === "telegram") return `${outcome} via Telegram`;
  if (approval.resolutionSource === "web") {
    return `${outcome} by ${reviewerLabel(event, approval)}`;
  }
  return `${outcome} decision recorded`;
}

export function ApprovalsClient() {
  const { streaming, setStreaming } = useHermes();
  const activityQuery = useGatewayActivity(streaming);
  const approvalsQuery = useApprovals(streaming);
  const { data: agentData } = useAgents();
  const agents = agentData?.agents ?? [];
  const events = useMemo(() => activityQuery.data?.activity ?? [], [activityQuery.data?.activity]);
  const counts = activityQuery.data?.aggregates.decisionCounts ?? {
    allow: 0,
    hold: 0,
    deny: 0,
  };
  const [filter, setFilter] = useState<"all" | GatewayActivityDecision>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const approvalsByRequest = useMemo(
    () =>
      new Map(
        (approvalsQuery.data?.approvals ?? []).map((approval) => [
          approval.gatewayRequestId,
          approval,
        ]),
      ),
    [approvalsQuery.data?.approvals],
  );
  const visible = useMemo(
    () => events.filter((event) => filter === "all" || event.decision === filter).slice(0, 40),
    [events, filter],
  );
  const active = events.find((event) => event.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Policy gateway"
        title="Live gateway & human-in-the-loop hub"
        description="Every agent tool call is intercepted, signature-verified and evaluated against scoped policy. Held actions wait here for a human mandate."
        actions={
          <Button variant="outline" className="bg-surface" onClick={() => setStreaming(!streaming)}>
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
        {(["allow", "hold", "deny"] as GatewayActivityDecision[]).map((decision) => (
          <div key={decision} className="panel p-4">
            <DecisionBadge decision={decision} />
            <p className="mt-3 font-mono text-2xl font-semibold">{counts[decision]}</p>
            <p className="text-xs text-muted-foreground">
              {decision === "allow"
                ? "auto-executed calls in window"
                : decision === "hold"
                  ? "awaiting human mandate"
                  : "blocked by policy engine"}
            </p>
          </div>
        ))}
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
        <TabsList className="bg-surface">
          <TabsTrigger value="all">All traffic</TabsTrigger>
          <TabsTrigger value="hold">Holds</TabsTrigger>
          <TabsTrigger value="deny">Denied</TabsTrigger>
          <TabsTrigger value="allow">Allowed</TabsTrigger>
        </TabsList>
      </Tabs>

      {activityQuery.isLoading || approvalsQuery.isLoading ? (
        <p className="panel p-8 text-sm text-muted-foreground">Loading live gateway activity…</p>
      ) : null}
      {activityQuery.error ? (
        <p role="alert" className="panel p-8 text-sm text-risk-high">
          Unable to load gateway activity: {activityQuery.error.message}
        </p>
      ) : null}
      {approvalsQuery.error ? (
        <p role="alert" className="panel p-8 text-sm text-risk-high">
          Unable to load approval details: {approvalsQuery.error.message}
        </p>
      ) : null}

      <div className="panel divide-y divide-border overflow-hidden">
        <AnimatePresence initial={false}>
          {visible.map((event) => {
            const agent = findAgent(agents, event.agentSlug);
            const delivery =
              approvalsByRequest.get(event.id)?.telegramDeliveryState ??
              event.telegramDeliveryState;

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
                    <span className="text-sm font-medium">{agent?.name ?? event.agentName}</span>
                    <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-cyan-accent">
                      {event.tool}
                    </span>
                    {delivery && delivery !== "not_requested" ? (
                      <span className="rounded-full border border-cyan-accent/40 bg-cyan-accent/10 px-2 py-0.5 text-[10px] text-cyan-accent">
                        {telegramLabel(delivery).toLowerCase()}
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
        {!activityQuery.isLoading && !activityQuery.error && visible.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground">
            No gateway activity matches this filter.
          </p>
        ) : null}
      </div>

      <ReviewDrawer
        event={active}
        approval={active ? approvalsByRequest.get(active.id) : undefined}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function ReviewDrawer({
  event,
  approval,
  onClose,
}: {
  event: GatewayActivityItem | null;
  approval: ApprovalDto | undefined;
  onClose: () => void;
}) {
  const actor = useActor();
  const resolution = useResolveApproval();
  const { data } = useAgents();
  const agent = event ? findAgent(data?.agents ?? [], event.agentSlug) : undefined;
  const canReview =
    !!actor &&
    (actor.role === "owner" ||
      (actor.role === "admin" && actor.userId === approval?.assignedReviewerUserId));
  const pending = event?.decision === "hold" && approval?.status === "pending";

  async function resolve(decision: ApprovalDecision) {
    if (!approval || !pending || !canReview) return;
    try {
      await resolution.mutateAsync({
        id: approval.id,
        decision,
        reason:
          decision === "allow"
            ? "Approved from the HermesPass dashboard."
            : "Denied from the HermesPass dashboard.",
      });
      if (decision === "allow") {
        toast.success("Action approved", {
          description: "The authoritative approval decision has been recorded.",
        });
      } else {
        toast.error("Action rejected", {
          description: "The authoritative denial has been recorded.",
        });
      }
      onClose();
    } catch (error) {
      toast.error("Approval could not be resolved", {
        description: error instanceof Error ? error.message : "Request failed",
      });
    }
  }

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {event ? (
          <>
            <SheetHeader>
              <SheetTitle>Human review</SheetTitle>
              <SheetDescription>
                Request {event.id} intercepted by the policy proxy at {timeOf(event.timestamp)}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <div className="rounded-lg border border-border bg-background/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{agent?.name ?? event.agentName}</p>
                  {agent ? <RiskBadge risk={agent.risk} /> : null}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-cyan-accent">
                  {event.agentDid}
                </p>
              </div>

              <div>
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  Requested action
                </p>
                <p className="mt-1 text-sm">{event.summary}</p>
                {event.amountCents !== null && event.currency ? (
                  <p className="mt-1 font-mono text-lg font-semibold text-risk-medium">
                    {formatAmount(event.amountCents, event.currency)}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  Policy evaluation
                </p>
                <p className="mt-1 flex items-center gap-2">
                  <DecisionBadge decision={event.decision} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {event.policyVersion === null
                      ? "Policy version unavailable"
                      : `Policy v${event.policyVersion}`}
                  </span>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{event.reason}</p>
              </div>

              <dl className="space-y-3 rounded-lg border border-border bg-background/60 p-4 text-xs">
                <div>
                  <dt className="tracking-wide text-muted-foreground uppercase">Request digest</dt>
                  <dd className="mt-1 font-mono break-all">{event.requestDigest}</dd>
                </div>
                <div>
                  <dt className="tracking-wide text-muted-foreground uppercase">Key thumbprint</dt>
                  <dd className="mt-1 font-mono break-all text-emerald-accent">
                    {event.keyThumbprint}
                  </dd>
                </div>
                <div>
                  <dt className="tracking-wide text-muted-foreground uppercase">
                    Assigned reviewer
                  </dt>
                  <dd className="mt-1">{reviewerLabel(event, approval)}</dd>
                </div>
                <div>
                  <dt className="tracking-wide text-muted-foreground uppercase">
                    Authorization expiry
                  </dt>
                  <dd className="mt-1">
                    {event.authorizationExpiresAt
                      ? formatTimestamp(event.authorizationExpiresAt)
                      : pending
                        ? "Awaiting reviewer decision"
                        : "No active authorization"}
                  </dd>
                </div>
                <div>
                  <dt className="tracking-wide text-muted-foreground uppercase">
                    Telegram delivery
                  </dt>
                  <dd className="mt-1">
                    {telegramLabel(approval?.telegramDeliveryState ?? event.telegramDeliveryState)}
                  </dd>
                </div>
              </dl>

              {approval && approval.status !== "pending" ? (
                <p className="rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 p-3 text-xs text-emerald-accent">
                  {resolutionLabel(event, approval)}
                </p>
              ) : null}
              {resolution.error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-risk-high/30 bg-risk-high/10 p-3 text-xs text-risk-high"
                >
                  Unable to resolve approval: {resolution.error.message}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  className="flex-1 shadow-glow-emerald"
                  disabled={!pending || !canReview || resolution.isPending}
                  onClick={() => void resolve("allow")}
                >
                  <Check className="size-4" />
                  Approve action
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={!pending || !canReview || resolution.isPending}
                  onClick={() => void resolve("deny")}
                >
                  <X className="size-4" />
                  Reject action
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function findAgent(agents: AgentDto[], slug: string) {
  return agents.find((agent) => agent.slug === slug) ?? mockAgentBySlug(slug);
}
