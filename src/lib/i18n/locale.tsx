import * as OpenCC from "opencc-js";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Locale = "en" | "zh-hans" | "zh-hant";

export const ZH_LOCALES = ["zh-hans", "zh-hant"] as const;

export function isZhLocale(value: string): value is "zh-hans" | "zh-hant" {
  return value === "zh-hans" || value === "zh-hant";
}

const toTraditional = OpenCC.Converter({ from: "cn", to: "twp" });

/** Converts Simplified Chinese source copy to Traditional when needed. */
export function convert(text: string, locale: Locale): string {
  return locale === "zh-hant" ? toTraditional(text) : text;
}

/** Deeply converts every string in a plain data structure. */
export function localize<T>(value: T, locale: Locale): T {
  if (locale !== "zh-hant") return value;
  if (typeof value === "string") return toTraditional(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => localize(v, locale)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = localize(v, locale);
    }
    return out as unknown as T;
  }
  return value;
}

const LocaleContext = createContext<"zh-hans" | "zh-hant">("zh-hans");

export function LocaleProvider({
  locale,
  children,
}: {
  locale: "zh-hans" | "zh-hant";
  children: ReactNode;
}) {
  const value = useMemo(() => locale, [locale]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  "zh-hant": "繁體",
  "zh-hans": "简体",
};
