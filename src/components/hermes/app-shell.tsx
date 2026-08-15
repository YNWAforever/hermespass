import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  CreditCard,
  FileCheck2,
  Fingerprint,
  Gauge,
  Radio,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useHermes } from "@/lib/hermes-store";

const NAV = [
  { to: "/dashboard", label: "Overview", icon: Gauge },
  { to: "/dashboard/agents", label: "Agent Directory", icon: Fingerprint },
  { to: "/dashboard/approvals", label: "Policy Gateway", icon: Activity },
  { to: "/dashboard/wallets", label: "Scoped Wallets", icon: CreditCard },
  { to: "/dashboard/compliance", label: "Audit & Compliance", icon: FileCheck2 },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });
  const { events, streaming } = useHermes();
  const holds = events.filter((e) => e.decision === "hold").length;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid size-9 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent shadow-glow-emerald">
            <ShieldCheck className="size-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-sidebar-foreground">
              HermesPass
            </span>
            <span className="block font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              KYA Infrastructure
            </span>
          </span>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4",
                    active ? "text-emerald-accent" : "text-muted-foreground",
                  )}
                />
                {label}
                {to === "/approvals" && holds > 0 ? (
                  <span className="ml-auto rounded-full bg-risk-medium/15 px-1.5 py-0.5 font-mono text-[10px] text-risk-medium">
                    {holds}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4">
          <div className="rounded-lg border border-sidebar-border bg-surface-raised/60 p-3">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Organisation
            </p>
            <p className="mt-1 text-sm font-medium">Hermes Holdings APAC</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              did:web:hermespass.asia
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-5 py-3 backdrop-blur">
          <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
            <ShieldCheck className="size-5 text-emerald-accent" />
            <span className="text-sm font-semibold">HermesPass</span>
          </Link>
          <span className="hidden rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase sm:inline">
            env: production · hk / sg
          </span>
          <span className="ml-auto flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px]">
            <Radio
              className={cn(
                "size-3.5",
                streaming ? "text-emerald-accent" : "text-muted-foreground",
              )}
            />
            <span className="text-muted-foreground">
              Gateway {streaming ? "streaming" : "paused"}
            </span>
          </span>
          <Link
            to="/dashboard/approvals"
            className="flex items-center gap-2 rounded-full border border-risk-medium/40 bg-risk-medium/10 px-2.5 py-1 text-[11px] font-medium text-risk-medium"
          >
            {holds} pending review
          </Link>
        </header>

        <main className="min-w-0 flex-1 px-5 py-6 lg:px-8">{children}</main>

        <nav className="sticky bottom-0 z-30 flex items-center justify-between gap-1 border-t border-border bg-background/95 px-2 py-2 backdrop-blur lg:hidden">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-1 flex-col items-center gap-1 rounded-md px-1 py-1 text-[10px] text-muted-foreground"
            >
              <Icon className="size-4" />
              {label.split(" ")[0]}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
