import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { convert, isZhLocale, type ZhLocale } from "./locale";
import { ZH_CONTACT, ZH_PAGES, ZH_ROI } from "./zh-content";

export const ZH_SLUGS = [
  "index",
  "about",
  "benefits",
  "compliance-standards",
  "faq",
  "industries",
  "pricing",
  "product",
  "security",
  "solutions",
  "use-cases",
  "contact",
  "roi-calculator",
] as const;

export const ZH_STATIC_SLUGS = [
  "about",
  "benefits",
  "compliance-standards",
  "faq",
  "industries",
  "pricing",
  "product",
  "security",
  "solutions",
  "use-cases",
] as const;

export type ZhSlug = (typeof ZH_SLUGS)[number];
export type ZhStaticSlug = (typeof ZH_STATIC_SLUGS)[number];

export function isZhSlug(value: string): value is ZhSlug {
  return (ZH_SLUGS as ReadonlyArray<string>).includes(value);
}

export function isZhStaticSlug(value: string): value is ZhStaticSlug {
  return (ZH_STATIC_SLUGS as ReadonlyArray<string>).includes(value);
}

function metaFor(slug: ZhSlug) {
  if (slug === "roi-calculator") return ZH_ROI.meta;
  if (slug === "contact") return ZH_CONTACT.meta;
  return ZH_PAGES[slug]?.meta;
}

function openGraphLocale(locale: ZhLocale) {
  return locale === "zh-hant" ? "zh_HK" : "zh_CN";
}

export function zhMetadata(locale: string, slug: string): Metadata {
  if (!isZhLocale(locale) || !isZhSlug(slug)) notFound();
  const meta = metaFor(slug);
  if (!meta) notFound();

  const title = convert(meta.title, locale);
  const description = convert(meta.description, locale);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale: openGraphLocale(locale),
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}
