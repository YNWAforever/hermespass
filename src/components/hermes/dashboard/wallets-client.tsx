"use client";

import { CreditCard, Lock, Plus, Unlock } from "lucide-react";
import { toast } from "sonner";

import { useActor } from "@/components/auth/actor-context";
import { RiskBadge, StatusBadge } from "@/components/hermes/badges";
import { PageHeader } from "@/components/hermes/page-header";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatHKD } from "@/lib/hermes-constants";
import type { AgentDto } from "@/lib/agents/types";
import type { WalletCardDto } from "@/lib/payments/card-service";
import {
  useProvisionCard,
  useSetWalletStatus,
  useWalletAgentPolicy,
  useWalletAgents,
  useWalletCards,
} from "@/lib/payments/wallets-client";

export function WalletsClient() {
  const actor = useActor();
  const canMutate = !actor || actor.role === "owner" || actor.role === "admin";
  const walletsQuery = useWalletCards();
  const agentsQuery = useWalletAgents();
  const provision = useProvisionCard();
  const cards = walletsQuery.data?.cards ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const cardAgentIds = new Set(
    cards.filter((card) => card.status !== "canceled").map((card) => card.agentId),
  );
  const availableAgents = agents.filter(
    (agent) => agent.status === "active" && !cardAgentIds.has(agent.databaseId),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent payments"
        title="Scoped wallets & spend limits"
        description="Each agent carries a virtual card whose cardholder name is its DID. Every authorisation is checked against these ceilings before the network sees it."
      />

      {canMutate && availableAgents.length > 0 ? (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Provision a scoped card</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                An active passport and policy are required. Provider secrets never reach this page.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {availableAgents.map((agent) => (
              <Button
                key={agent.databaseId}
                variant="outline"
                className="bg-surface"
                disabled={provision.isPending}
                onClick={() =>
                  provision.mutate(agent.databaseId, {
                    onSuccess: () =>
                      toast.success("Scoped card provisioned", { description: agent.name }),
                    onError: (error) =>
                      toast.error("Unable to provision card", { description: error.message }),
                  })
                }
              >
                <Plus className="size-4" />
                {provision.isPending && provision.variables === agent.databaseId
                  ? "Provisioning…"
                  : `Provision card for ${agent.name}`}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {walletsQuery.isLoading || agentsQuery.isLoading ? (
        <p className="panel p-8 text-sm text-muted-foreground">Loading live scoped cards…</p>
      ) : null}
      {walletsQuery.error ? (
        <p role="alert" className="panel p-8 text-sm text-risk-high">
          Unable to load scoped cards: {walletsQuery.error.message}
        </p>
      ) : null}
      {agentsQuery.error ? (
        <p role="alert" className="panel p-8 text-sm text-risk-high">
          Unable to load cardholder agents: {agentsQuery.error.message}
        </p>
      ) : null}

      <div className="space-y-5">
        {cards
          .filter((card) => card.status !== "canceled")
          .map((card) => (
            <WalletRow
              key={card.id}
              card={card}
              agent={agents.find((agent) => agent.databaseId === card.agentId)}
              canMutate={canMutate}
            />
          ))}
        {!walletsQuery.isLoading && !walletsQuery.error && cards.length === 0 ? (
          <p className="panel p-8 text-sm text-muted-foreground">
            No scoped cards have been provisioned for this organization.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function WalletRow({
  card,
  agent,
  canMutate,
}: {
  card: WalletCardDto;
  agent: AgentDto | undefined;
  canMutate: boolean;
}) {
  const policyQuery = useWalletAgentPolicy(card.agentId);
  const setStatus = useSetWalletStatus();
  const policy = policyQuery.data?.policy;
  const nextStatus = card.status === "frozen" ? "active" : "frozen";
  const statusPending = setStatus.isPending && setStatus.variables?.id === card.id;

  function mutateStatus() {
    setStatus.mutate(
      { id: card.id, status: nextStatus },
      {
        onSuccess: () =>
          toast.success(nextStatus === "frozen" ? "Card frozen" : "Card unfrozen", {
            description: `${agent?.name ?? card.agentSlug} status updated.`,
          }),
        onError: (error) =>
          toast.error("Unable to change card status", { description: error.message }),
      },
    );
  }

  return (
    <section className="panel grid gap-6 p-5 lg:grid-cols-[22rem_1fr]">
      <div>
        <div className="relative aspect-[1.586/1] w-full overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,color-mix(in_oklab,var(--cyan-accent)_22%,var(--surface-raised)),var(--surface))] p-5 shadow-glow-cyan">
          <div className="flex items-start justify-between">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
              HermesPass Scoped Card
            </span>
            <CreditCard className="size-5 text-cyan-accent" />
          </div>
          <p className="mt-8 font-mono text-lg tracking-[0.18em]">
            {card.last4 ? `•••• •••• •••• ${card.last4}` : "Provisioning…"}
          </p>
          <div className="mt-5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                Cardholder (agent DID)
              </p>
              <p className="truncate font-mono text-[11px] text-cyan-accent">
                {agent?.id ?? card.agentDid}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {card.brand ?? "Pending"} · {card.rail}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {agent ? <StatusBadge status={agent.status} /> : null}
          {agent ? <RiskBadge risk={agent.risk} /> : null}
          <span className="rounded-full border border-border bg-surface-raised px-2 py-1 text-[10px] tracking-wide uppercase">
            Card {card.status}
          </span>
        </div>
        <p className="mt-3 text-sm font-medium">{agent?.name ?? card.agentSlug}</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          Spend to date: — · {card.currency} · policy v{card.policyVersion}
        </p>
      </div>

      <div className="space-y-6">
        {policyQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading active policy…</p>
        ) : policy ? (
          <>
            <CapSlider
              label="Per-transaction limit"
              value={policy.perTransactionLimitCents / 100}
              max={50000}
            />
            <CapSlider label="Daily limit" value={policy.dailyLimitCents / 100} max={100000} />
            <CapSlider label="Monthly limit" value={policy.monthlyLimitCents / 100} max={400000} />
            <div>
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Merchant category whitelist (MCC)
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {policy.mccAllowlist.length > 0 ? (
                  policy.mccAllowlist.map((mcc) => (
                    <span
                      key={mcc}
                      className="rounded border border-border bg-background/50 px-3 py-2 font-mono text-xs"
                    >
                      {mcc}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No MCC restriction</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-risk-medium">
            No active policy is attached to this cardholder.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Edit limits and MCC controls in the Agent Directory policy dialog.
          </p>
          {canMutate && (card.status === "active" || card.status === "frozen") ? (
            <Button
              variant="outline"
              className="bg-surface"
              disabled={statusPending}
              onClick={mutateStatus}
            >
              {nextStatus === "frozen" ? (
                <Lock className="size-4" />
              ) : (
                <Unlock className="size-4" />
              )}
              {statusPending
                ? "Updating…"
                : nextStatus === "frozen"
                  ? "Freeze card"
                  : "Unfreeze card"}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CapSlider({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm">{label}</p>
        <p className="font-mono text-sm font-semibold text-emerald-accent">{formatHKD(value)}</p>
      </div>
      <Slider className="mt-3" value={[value]} max={max} disabled />
    </div>
  );
}
