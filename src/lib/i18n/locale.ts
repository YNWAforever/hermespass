import * as OpenCC from "opencc-js";

export type Locale = "en" | "zh-hans" | "zh-hant";
export type ZhLocale = Exclude<Locale, "en">;

export const ZH_LOCALES = ["zh-hans", "zh-hant"] as const satisfies ReadonlyArray<ZhLocale>;

export function isZhLocale(value: string): value is ZhLocale {
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
    return value.map((item) => localize(item, locale)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const localized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      localized[key] = localize(item, locale);
    }
    return localized as T;
  }
  return value;
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  "zh-hant": "繁體",
  "zh-hans": "简体",
};
