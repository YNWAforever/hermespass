import { Link } from "@tanstack/react-router";
import { ArrowRight, Menu, ShieldCheck, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const SITE_NAV = [
  { to: "/product", label: "Product" },
  { to: "/use-cases", label: "Use cases" },
  { to: "/benefits", label: "Benefits" },
  { to: "/industries", label: "Industries" },
  { to: "/compliance-standards", label: "Compliance" },
  { to: "/pricing", label: "Pricing" },
] as const;


export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent shadow-glow-emerald">
            <ShieldCheck className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            HermesPass
          </span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 md:flex">
          {SITE_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
              activeProps={{ className: "text-foreground bg-surface" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/dashboard"
            className="hidden rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface sm:inline-flex"
          >
            Live demo
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Book a briefing <ArrowRight className="size-3.5" />
          </Link>
          <button
            type="button"
            aria-label="Toggle navigation"
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground md:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav className="border-t border-border bg-surface px-5 py-3 md:hidden">
          {[...SITE_NAV, { to: "/dashboard", label: "Live demo" } as const].map(
            (item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="block rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
      ) : null}
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-sidebar">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent">
              <ShieldCheck className="size-4" />
            </span>
            <span className="text-sm font-semibold">HermesPass</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Know Your Agent infrastructure: verifiable identity, real-time
            authority and provable audit for enterprise AI agents.
          </p>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            did:web:hermespass.asia
          </p>
        </div>

        <FooterCol
          title="Platform"
          links={[
            { to: "/product", label: "Product overview" },
            { to: "/dashboard/agents", label: "Agent passports" },
            { to: "/dashboard/approvals", label: "Policy gateway" },
            { to: "/dashboard/wallets", label: "Scoped wallets" },
            { to: "/dashboard/compliance", label: "Audit chain" },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { to: "/use-cases", label: "Use cases" },
            { to: "/benefits", label: "Benefits" },
            { to: "/industries", label: "Industries" },
            { to: "/solutions", label: "Solutions" },
            { to: "/about", label: "About" },
            { to: "/contact", label: "Contact" },
          ]}
        />

        <div>
          <p className="text-xs font-semibold tracking-wide uppercase">
            Standards we build to
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>W3C Verifiable Credentials 2.0</li>
            <li>W3C Decentralized Identifiers (DID)</li>
            <li>IMDA Model AI Governance for GenAI</li>
            <li>HKMA GenA.I. Sandbox</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border px-5 py-5">
        <p className="mx-auto max-w-6xl text-xs text-muted-foreground">
          © {new Date().getFullYear()} HermesPass. Product surfaces shown in the
          live demo use simulated data.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ to: string; label: string }>;
}) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide uppercase">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              to={l.to}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("px-5 py-16 sm:py-20", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
      )}
    >
      <p className="font-mono text-[11px] tracking-[0.22em] text-emerald-accent uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">{title}</h2>
      {description ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function CtaBand({
  title = "See KYA running on your agent estate",
  description = "A 30-minute technical briefing: passport issuance, gateway policy, spend controls and the audit export your regulator will ask for.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Section>
      <div className="panel grid-backdrop relative overflow-hidden p-8 text-center sm:p-12">
        <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          {description}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            to="/contact"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
          >
            Book a briefing <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
          >
            Explore the live demo
          </Link>
        </div>
      </div>
    </Section>
  );
}
