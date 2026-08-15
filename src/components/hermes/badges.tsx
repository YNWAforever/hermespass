import { CheckCircle2, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Decision, PassportStatus, RiskTier } from "@/lib/hermes-data";

export function RiskBadge({
  risk,
  className,
}: {
  risk: RiskTier;
  className?: string;
}) {
  const map: Record<RiskTier, { label: string; cls: string }> = {
    low: {
      label: "Low risk",
      cls: "text-risk-low border-risk-low/40 bg-risk-low/10",
    },
    medium: {
      label: "Medium risk",
      cls: "text-risk-medium border-risk-medium/40 bg-risk-medium/10",
    },
    high: {
      label: "High risk",
      cls: "text-risk-high border-risk-high/40 bg-risk-high/10",
    },
  };
  const { label, cls } = map[risk];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        cls,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: PassportStatus }) {
  const map: Record<
    PassportStatus,
    { label: string; cls: string; icon: typeof ShieldCheck }
  > = {
    active: {
      label: "Active",
      cls: "text-emerald-accent border-emerald-accent/40 bg-emerald-accent/10 shadow-glow-emerald",
      icon: ShieldCheck,
    },
    audit: {
      label: "Under audit",
      cls: "text-risk-medium border-risk-medium/40 bg-risk-medium/10",
      icon: ShieldAlert,
    },
    revoked: {
      label: "Revoked",
      cls: "text-risk-high border-risk-high/40 bg-risk-high/10",
      icon: ShieldX,
    },
  };
  const { label, cls, icon: Icon } = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase",
        cls,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

export function DecisionBadge({
  decision,
  className,
}: {
  decision: Decision;
  className?: string;
}) {
  const map: Record<Decision, { label: string; cls: string }> = {
    allow: {
      label: "Allow",
      cls: "text-risk-low border-risk-low/40 bg-risk-low/10",
    },
    deny: {
      label: "Deny",
      cls: "text-risk-high border-risk-high/40 bg-risk-high/10",
    },
    hold: {
      label: "Hold · pending review",
      cls: "text-risk-medium border-risk-medium/50 bg-risk-medium/10 animate-hold-pulse",
    },
  };
  const { label, cls } = map[decision];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider whitespace-nowrap uppercase",
        cls,
        className,
      )}
    >
      {label}
    </span>
  );
}

export function VerifiedPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-cyan-accent/40 bg-cyan-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-accent",
        className,
      )}
    >
      <CheckCircle2 className="size-3.5" />
      W3C VC Verified
    </span>
  );
}
