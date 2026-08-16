"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/lib/i18n/locale-context";
import { localize } from "@/lib/i18n/locale";
import { ZH_CONTACT } from "@/lib/i18n/zh-content";
import { ZhHeading, ZhSection as Wrap, ZhShell } from "@/components/marketing/zh-shell";
import { cn } from "@/lib/utils";

type Field = "name" | "email" | "company" | "role" | "agents" | "message";

export function ZhContactPage() {
  const locale = useLocale();
  const t = localize(ZH_CONTACT, locale);

  const [values, setValues] = useState<Record<Field, string>>({
    name: "",
    email: "",
    company: "",
    role: "",
    agents: "",
    message: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [sent, setSent] = useState(false);

  function set(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    for (const f of ["name", "email", "company"] as Field[]) {
      if (!values[f].trim()) next[f] = t.errors.required;
    }
    if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      next.email = t.errors.email;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) setSent(true);
  }

  return (
    <ZhShell>
      <Wrap className="grid-backdrop border-b border-border">
        <ZhHeading eyebrow={t.hero.eyebrow} title={t.hero.title} description={t.hero.description} />
      </Wrap>

      <Wrap>
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {sent ? (
              <div className="panel flex items-center gap-3 border-emerald-accent/40">
                <span className="grid size-9 place-items-center rounded-lg border border-emerald-accent/40 bg-emerald-accent/10 text-emerald-accent">
                  <Check className="size-4" />
                </span>
                <p className="text-sm">{t.success}</p>
              </div>
            ) : (
              <form onSubmit={submit} className="panel grid gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField
                    label={t.fields.name}
                    value={values.name}
                    error={errors.name}
                    onChange={(v) => set("name", v)}
                  />
                  <TextField
                    label={t.fields.email}
                    type="email"
                    value={values.email}
                    error={errors.email}
                    onChange={(v) => set("email", v)}
                  />
                  <TextField
                    label={t.fields.company}
                    value={values.company}
                    error={errors.company}
                    onChange={(v) => set("company", v)}
                  />
                  <TextField
                    label={t.fields.role}
                    value={values.role}
                    onChange={(v) => set("role", v)}
                  />
                  <TextField
                    label={t.fields.agents}
                    type="number"
                    value={values.agents}
                    onChange={(v) => set("agents", v)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t.fields.message}</label>
                  <textarea
                    rows={4}
                    value={values.message}
                    onChange={(e) => set("message", e.target.value)}
                    className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-accent focus:ring-1 focus:ring-emerald-accent"
                  />
                </div>
                <button
                  type="submit"
                  className="justify-self-start rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow-emerald transition-opacity hover:opacity-90"
                >
                  {t.submit}
                </button>
              </form>
            )}
          </div>

          <div className="lg:col-span-5">
            <div className="panel">
              <h2 className="text-base font-semibold">{t.aside.title}</h2>
              <ul className="mt-4 space-y-2">
                {t.aside.items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-accent" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-5 font-mono text-[11px] text-muted-foreground">
                did:web:hermespass.asia
              </p>
            </div>
          </div>
        </div>
      </Wrap>
    </ZhShell>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  type?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-accent focus:ring-1 focus:ring-emerald-accent",
          error && "border-destructive",
        )}
      />
      {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
