import { Link } from "@tanstack/react-router";
import { ArrowRight, Menu, ShieldCheck, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LOCALE_LABELS, localize, useLocale } from "@/lib/i18n/locale";
import { ZH_UI } from "@/lib/i18n/zh-content";
import { cn } from "@/lib/utils";

/** Locale-aware link that accepts a plain resolved path. */
export function LocaleLink({
  href,
  className,
  children,
  onClick,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link to={href as never} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export function useZhUi() {
  const locale = useLocale();
  return { locale, ui: localize(ZH_UI, locale) };
}

export function ZhShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ZhHeader />
      <main className="flex-1">{children}</main>
      <ZhFooter />
    </div>
  );
}

function LanguageSwitcher({ path }: { path: string }) {
  const locale = useLocale();
  const targets: Array<{ code: "en" | "zh-hant" | "zh-hans"; href: string }> = [
    { code: "en", href: path ? `/${path}` : "/" },
    { code: "zh-hant", href: path ? `/zh-hant/${path}` : "/zh-hant" },
    { code: "zh-hans", href: path ? `/zh-hans/${path}` : "/zh-hans" },
  ];

  return (
    <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
      {targets.map((t) => (
        <LocaleLink
          key={t.code}
          href={t.href}
          className={cn(
            "rounded-md px-2 py-1 text-xs transition-colors",
            t.code === locale
              ? "bg-surface-raised text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LOCALE_LABELS[t.code]}
        </LocaleLink>
      ))}
    </div>
  );
}

function ZhHeader() {
  const [open, setOpen] = useState(false);
  const { locale, ui } = useZhUi();
  const base = `/${locale}`;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
        <LocaleLink href={base} className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent shadow-glow-emerald">
            <ShieldCheck className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            HermesPass
          </span>
        </LocaleLink>

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {ui.nav.map((item) => (
            <LocaleLink
              key={item.slug}
              href={`${base}/${item.slug}`}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              {item.label}
            </LocaleLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher path="" />
          <LocaleLink
            href={`${base}/contact`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {ui.bookBriefing} <ArrowRight className="size-3.5" />
          </LocaleLink>
          <button
            type="button"
            aria-label={ui.toggleNav}
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav className="border-t border-border bg-surface px-5 py-3 lg:hidden">
          {ui.nav.map((item) => (
            <LocaleLink
              key={item.slug}
              href={`${base}/${item.slug}`}
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              {item.label}
            </LocaleLink>
          ))}
          <LocaleLink
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {ui.demo}
          </LocaleLink>
        </nav>
      ) : null}
    </header>
  );
}

function ZhFooter() {
  const { locale, ui } = useZhUi();
  const base = `/${locale}`;

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
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {ui.brandTagline}
          </p>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            did:web:hermespass.asia
          </p>
          <div className="mt-4">
            <LanguageSwitcher path="" />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide uppercase">
            {ui.footerPlatform}
          </p>
          <ul className="mt-3 space-y-2">
            {ui.nav.slice(0, 5).map((l) => (
              <li key={l.slug}>
                <LocaleLink
                  href={`${base}/${l.slug}`}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {l.label}
                </LocaleLink>
              </li>
            ))}
            <li>
              <LocaleLink
                href="/dashboard"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {ui.demo}
              </LocaleLink>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide uppercase">
            {ui.footerCompany}
          </p>
          <ul className="mt-3 space-y-2">
            {[
              { slug: "security", label: ui.nav[5]?.label ?? "信任中心" },
              { slug: "roi-calculator", label: ui.nav[6]?.label ?? "ROI" },
              { slug: "faq", label: ui.nav[7]?.label ?? "常见问题" },
              { slug: "pricing", label: ui.nav[8]?.label ?? "价格" },
              { slug: "solutions", label: localize("解决方案", locale) },
              { slug: "about", label: localize("关于我们", locale) },
              { slug: "contact", label: localize("联系我们", locale) },
            ].map((l) => (
              <li key={l.slug}>
                <LocaleLink
                  href={`${base}/${l.slug}`}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {l.label}
                </LocaleLink>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide uppercase">
            {ui.footerStandards}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {ui.standards.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border px-5 py-5">
        <p className="mx-auto max-w-6xl text-xs text-muted-foreground">
          © {new Date().getFullYear()} {ui.footerNote}
        </p>
      </div>
    </footer>
  );
}

export function ZhSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("px-5 py-16 sm:py-20", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function ZhHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-3xl">
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

export function ZhCtaBand({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { locale, ui } = useZhUi();
  return (
    <ZhSection>
      <div className="panel grid-backdrop relative overflow-hidden p-8 text-center sm:p-12">
        <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <LocaleLink
            href={`/${locale}/contact`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
          >
            {ui.ctaPrimary} <ArrowRight className="size-4" />
          </LocaleLink>
          <LocaleLink
            href="/dashboard"
            className="inline-flex items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
          >
            {ui.ctaSecondary}
          </LocaleLink>
        </div>
      </div>
    </ZhSection>
  );
}
