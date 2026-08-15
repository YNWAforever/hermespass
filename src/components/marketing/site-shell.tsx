import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  Calculator,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileCheck2,
  Info,
  Layers,
  LayoutDashboard,
  Menu,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Tags,
  Target,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: typeof ShieldCheck;
};

type NavGroup = {
  id: string;
  label: string;
  blurb: string;
  items: ReadonlyArray<NavItem>;
  footer?: { to: string; label: string };
};

export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    id: "platform",
    label: "Platform",
    blurb: "Identity, authority and evidence for autonomous agents.",
    items: [
      {
        to: "/product",
        label: "Product overview",
        description: "Passports, policy gateway, scoped wallets, audit chain.",
        icon: Layers,
      },
      {
        to: "/dashboard/agents",
        label: "Agent passports",
        description: "DID + W3C Verifiable Credential issuance.",
        icon: ShieldCheck,
      },
      {
        to: "/dashboard/approvals",
        label: "Policy gateway",
        description: "Real-time ALLOW / DENY / HOLD with human review.",
        icon: Workflow,
      },
      {
        to: "/dashboard/wallets",
        label: "Scoped wallets",
        description: "Spend caps and MCC whitelists per agent.",
        icon: CreditCard,
      },
      {
        to: "/dashboard/compliance",
        label: "Audit chain",
        description: "Tamper-evident hash chain and one-click export.",
        icon: ScrollText,
      },
    ],
    footer: { to: "/dashboard", label: "Explore the live demo" },
  },
  {
    id: "solutions",
    label: "Solutions",
    blurb: "Where KYA removes risk across your agent estate.",
    items: [
      {
        to: "/use-cases",
        label: "Use cases",
        description: "Six governed agent workflows, before and after.",
        icon: Target,
      },
      {
        to: "/industries",
        label: "Industries",
        description: "Banking, insurance, commerce, ad tech and more.",
        icon: Building2,
      },
      {
        to: "/solutions",
        label: "By team",
        description: "Risk, compliance, platform and finance owners.",
        icon: Sparkles,
      },
      {
        to: "/benefits",
        label: "Benefits",
        description: "Value delivered and how we differ from IAM.",
        icon: Layers,
      },
    ],
  },
  {
    id: "trust",
    label: "Trust & compliance",
    blurb: "Evidence your regulator and security team will ask for.",
    items: [
      {
        to: "/compliance-standards",
        label: "Compliance standards",
        description: "IMDA, HKMA, PDPO/PDPA and W3C alignment.",
        icon: FileCheck2,
      },
      {
        to: "/security",
        label: "Trust Center",
        description: "Security posture, artifacts, hash-chain logging.",
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    blurb: "Build the internal business case.",
    items: [
      {
        to: "/roi-calculator",
        label: "ROI calculator",
        description: "Estimate review hours and spend leakage recovered.",
        icon: Calculator,
      },
      {
        to: "/faq",
        label: "FAQ",
        description: "Passports, approvals, export and reporting.",
        icon: CircleHelp,
      },
      {
        to: "/about",
        label: "About HermesPass",
        description: "The KYA thesis and standards alignment.",
        icon: Info,
      },
      {
        to: "/contact",
        label: "Contact us",
        description: "Book a 30-minute technical briefing.",
        icon: MessageSquare,
      },
    ],
  },
] as const;

export const SITE_NAV = [
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
  const [active, setActive] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl"
      onMouseLeave={() => setActive(null)}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
        <Link
          to="/"
          className="flex items-center gap-2.5"
          onMouseEnter={() => setActive(null)}
        >
          <span className="grid size-8 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent shadow-glow-emerald">
            <ShieldCheck className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            HermesPass
          </span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              aria-expanded={active === group.id}
              onMouseEnter={() => setActive(group.id)}
              onClick={() =>
                setActive((v) => (v === group.id ? null : group.id))
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                active === group.id
                  ? "bg-surface text-foreground"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              {group.label}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  active === group.id && "rotate-180",
                )}
              />
            </button>
          ))}
          {SITE_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onMouseEnter={() => setActive(null)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
              activeProps={{ className: "text-foreground bg-surface" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center rounded-lg border border-border bg-surface p-0.5 sm:flex">
            <span className="rounded-md bg-surface-raised px-2 py-1 text-xs text-foreground">
              EN
            </span>
            <Link
              to="/$locale"
              params={{ locale: "zh-hant" }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              繁體
            </Link>
            <Link
              to="/$locale"
              params={{ locale: "zh-hans" }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              简体
            </Link>
          </div>
          <Link
            to="/dashboard"
            className="hidden rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface lg:inline-flex"
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
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {active ? (
        <div className="hidden border-t border-border bg-background/95 backdrop-blur-xl lg:block">
          {NAV_GROUPS.filter((g) => g.id === active).map((group) => (
            <div
              key={group.id}
              className="mx-auto grid max-w-6xl gap-8 px-5 py-7 lg:grid-cols-[minmax(0,15rem)_1fr]"
            >
              <div>
                <p className="font-mono text-[11px] tracking-[0.22em] text-emerald-accent uppercase">
                  {group.label}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {group.blurb}
                </p>
                {group.footer ? (
                  <Link
                    to={group.footer.to}
                    onClick={() => setActive(null)}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm text-foreground transition-opacity hover:opacity-80"
                  >
                    {group.footer.label}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : null}
              </div>

              <div className="grid gap-1.5 sm:grid-cols-2">
                {group.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setActive(null)}
                    className="group flex gap-3 rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-surface"
                  >
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-emerald-accent">
                      <item.icon className="size-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {open ? (
        <nav className="max-h-[75vh] overflow-y-auto border-t border-border bg-surface px-5 py-4 lg:hidden">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-4">
              <p className="font-mono text-[11px] tracking-[0.18em] text-emerald-accent uppercase">
                {group.label}
              </p>
              <div className="mt-1.5">
                {group.items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <div className="border-t border-border pt-3">
            <Link
              to="/pricing"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Tags className="size-4" /> Pricing
            </Link>
            <Link
              to="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <LayoutDashboard className="size-4" /> Live demo
            </Link>
          </div>
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
            { to: "/roi-calculator", label: "ROI calculator" },
            { to: "/security", label: "Trust Center" },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { to: "/use-cases", label: "Use cases" },
            { to: "/benefits", label: "Benefits" },
            { to: "/industries", label: "Industries" },
            { to: "/solutions", label: "Solutions" },
            { to: "/faq", label: "FAQ" },
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
