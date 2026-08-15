import { convert, isZhLocale, type Locale } from "./locale";
import { ZH_CONTACT, ZH_PAGES, ZH_ROI } from "./zh-content";

function metaFor(slug: string) {
  if (slug === "roi-calculator") return ZH_ROI.meta;
  if (slug === "contact") return ZH_CONTACT.meta;
  return ZH_PAGES[slug]?.meta;
}

export function zhHead(localeParam: string, slug: string) {
  const locale: Locale = isZhLocale(localeParam) ? localeParam : "zh-hans";
  const meta = metaFor(slug);
  if (!meta) return { meta: [{ title: "HermesPass" }] };

  const title = convert(meta.title, locale);
  const description = convert(meta.description, locale);

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: locale === "zh-hant" ? "zh_HK" : "zh_CN" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  };
}
