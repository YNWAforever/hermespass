import { ArrowRight, Check } from "lucide-react";
import { localize, useLocale } from "@/lib/i18n/locale";
import {
  ZH_PAGES,
  ZH_UI,
  type ZhPageContent,
  type ZhSection,
} from "@/lib/i18n/zh-content";
import {
  LocaleLink,
  ZhCtaBand,
  ZhHeading,
  ZhSection as Wrap,
  ZhShell,
} from "@/components/marketing/zh-shell";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

export function ZhPage({ slug }: { slug: keyof typeof ZH_PAGES | string }) {
  const locale = useLocale();
  const raw = ZH_PAGES[slug];
  if (!raw) return null;
  const page = localize<ZhPageContent>(raw, locale);
  const ui = localize(ZH_UI, locale);

  return (
    <ZhShell>
      <Wrap className="grid-backdrop border-b border-border">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] tracking-[0.22em] text-emerald-accent uppercase">
            {page.hero.eyebrow}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
            {page.hero.title}
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            {page.hero.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LocaleLink
              href={`/${locale}/contact`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
            >
              {ui.bookBriefing} <ArrowRight className="size-4" />
            </LocaleLink>
            <LocaleLink
              href="/dashboard"
              className="inline-flex items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
            >
              {ui.demo}
            </LocaleLink>
          </div>
        </div>
      </Wrap>

      {page.sections.map((section, i) => (
        <SectionBlock key={i} section={section} />
      ))}

      <ZhCtaBand
        title={page.cta?.title ?? ui.defaultCta.title}
        description={page.cta?.description ?? ui.defaultCta.description}
      />
    </ZhShell>
  );
}

function SectionBlock({ section }: { section: ZhSection }) {
  if (section.kind === "stats") {
    return (
      <Wrap className="border-b border-border">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {section.items.map((s) => (
            <div key={s.label} className="panel">
              <p className="text-2xl font-semibold tracking-tight text-emerald-accent">
                {s.value}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </Wrap>
    );
  }

  if (section.kind === "cards") {
    return (
      <Wrap>
        <ZhHeading {...section} />
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {section.items.map((item) => (
            <div key={item.title} className="panel">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Wrap>
    );
  }

  if (section.kind === "steps") {
    return (
      <Wrap className="border-y border-border bg-sidebar/40">
        <ZhHeading {...section} />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {section.items.map((item) => (
            <div key={item.title} className="panel">
              <h3 className="text-sm font-semibold text-emerald-accent">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Wrap>
    );
  }

  if (section.kind === "compare") {
    return (
      <Wrap>
        <ZhHeading {...section} />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {section.items.map((item) => (
            <div key={item.title} className="panel">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <div className="mt-4 grid gap-3">
                <div className="rounded-lg border border-border bg-surface p-4">
                  <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                    {section.beforeLabel}
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {item.before}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-accent/30 bg-emerald-accent/10 p-4">
                  <p className="font-mono text-[10px] tracking-wider text-emerald-accent uppercase">
                    {section.afterLabel}
                  </p>
                  <p className="mt-1.5 text-sm text-foreground">{item.after}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Wrap>
    );
  }

  if (section.kind === "table") {
    return (
      <Wrap className="border-y border-border bg-sidebar/40">
        <ZhHeading {...section} />
        <div className="panel mt-8 overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface">
              <tr>
                {section.columns.map((c) => (
                  <th
                    key={c}
                    className="px-5 py-3 font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {section.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        "px-5 py-4 align-top",
                        j === 0
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Wrap>
    );
  }

  if (section.kind === "code") {
    return (
      <Wrap>
        <ZhHeading {...section} />
        <pre className="panel mt-8 overflow-x-auto font-mono text-xs leading-relaxed text-muted-foreground">
          {section.code}
        </pre>
      </Wrap>
    );
  }

  if (section.kind === "plans") {
    return (
      <Wrap>
        <ZhHeading {...section} />
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {section.items.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "panel flex flex-col",
                plan.highlight &&
                  "border-emerald-accent/40 shadow-glow-emerald",
              )}
            >
              <h3 className="text-base font-semibold">{plan.name}</h3>
              <p className="mt-2 text-xl font-semibold tracking-tight text-emerald-accent">
                {plan.price}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{plan.blurb}</p>
              <ul className="mt-5 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-accent" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Wrap>
    );
  }

  // faq
  return (
    <Wrap>
      <ZhHeading {...section} />
      <Accordion type="single" collapsible className="mt-6 max-w-3xl">
        {section.items.map((item, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger className="text-left text-sm">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Wrap>
  );
}
