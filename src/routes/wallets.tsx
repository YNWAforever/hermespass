import { createFileRoute } from "@tanstack/react-router";
import { CreditCard, Lock } from "lucide-react";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/hermes/page-header";
import { RiskBadge, StatusBadge } from "@/components/hermes/badges";
import { useHermes } from "@/lib/hermes-store";
import { MCC_CATEGORIES, formatHKD, type Wallet } from "@/lib/hermes-data";

export const Route = createFileRoute("/wallets")({
  head: () => ({
    meta: [
      { title: "Scoped Agent Wallets & Spend Limits — HermesPass" },
      {
        name: "description",
        content:
          "Issue virtual cards bound to agent DIDs, then tune per-transaction, daily and monthly ceilings plus merchant category whitelists.",
      },
      {
        property: "og:title",
        content: "Scoped Agent Wallets & Spend Limits — HermesPass",
      },
      {
        property: "og:description",
        content:
          "Virtual cards with agent-scoped spend caps and MCC whitelists for autonomous payments.",
      },
    ],
  }),
  component: WalletsPage,
});

function WalletsPage() {
  const { wallets, agentBySlug } = useHermes();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent payments"
        title="Scoped wallets & spend limits"
        description="Each agent carries a virtual card whose cardholder name is its DID. Every authorisation is checked against these ceilings before the network sees it."
      />

      <div className="space-y-5">
        {wallets.map((wallet) => (
          <WalletRow
            key={wallet.agentSlug}
            wallet={wallet}
            agentName={agentBySlug(wallet.agentSlug)?.name}
          />
        ))}
      </div>
    </div>
  );
}

function WalletRow({
  wallet,
  agentName,
}: {
  wallet: Wallet;
  agentName?: string;
}) {
  const { updateWallet, agentBySlug } = useHermes();
  const agent = agentBySlug(wallet.agentSlug);
  const utilisation = Math.min(
    100,
    Math.round((wallet.spentThisMonth / Math.max(1, wallet.monthly)) * 100),
  );

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
            •••• •••• •••• {wallet.pan}
          </p>
          <div className="mt-5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                Cardholder (agent DID)
              </p>
              <p className="truncate font-mono text-[11px] text-cyan-accent">
                {agent?.id ?? wallet.agentSlug}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {wallet.network}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {agent ? <StatusBadge status={agent.status} /> : null}
          {agent ? <RiskBadge risk={agent.risk} /> : null}
        </div>
        <p className="mt-3 text-sm font-medium">{agentName ?? wallet.agentSlug}</p>
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-emerald-accent"
              style={{ width: `${utilisation}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
            {formatHKD(wallet.spentThisMonth)} of {formatHKD(wallet.monthly)}{" "}
            monthly ({utilisation}%)
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <CapSlider
          label="Per-transaction limit"
          value={wallet.perTx}
          max={50000}
          step={100}
          onChange={(v) => updateWallet(wallet.agentSlug, { perTx: v })}
        />
        <CapSlider
          label="Daily limit"
          value={wallet.daily}
          max={100000}
          step={500}
          onChange={(v) => updateWallet(wallet.agentSlug, { daily: v })}
        />
        <CapSlider
          label="Monthly limit"
          value={wallet.monthly}
          max={400000}
          step={1000}
          onChange={(v) => updateWallet(wallet.agentSlug, { monthly: v })}
        />

        <div>
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Merchant category whitelist (MCC)
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {MCC_CATEGORIES.map((cat) => {
              const on = wallet.mcc.includes(cat);
              return (
                <label
                  key={cat}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm"
                >
                  <span className={on ? "" : "text-muted-foreground"}>{cat}</span>
                  <Switch
                    checked={on}
                    onCheckedChange={(checked) =>
                      updateWallet(wallet.agentSlug, {
                        mcc: checked
                          ? [...wallet.mcc, cat]
                          : wallet.mcc.filter((c) => c !== cat),
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Limits apply at authorisation time via the AP2 payment mandate.
          </p>
          <Button
            variant="outline"
            className="bg-surface"
            onClick={() => {
              updateWallet(wallet.agentSlug, { perTx: 0, daily: 0 });
              toast.error("Card frozen", {
                description: `${agentName ?? wallet.agentSlug} can no longer authorise payments.`,
              });
            }}
          >
            <Lock className="size-4" />
            Freeze card
          </Button>
        </div>
      </div>
    </section>
  );
}

function CapSlider({
  label,
  value,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm">{label}</p>
        <p className="font-mono text-sm font-semibold text-emerald-accent">
          {formatHKD(value)}
        </p>
      </div>
      <Slider
        className="mt-3"
        value={[value]}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v ?? 0)}
      />
    </div>
  );
}
