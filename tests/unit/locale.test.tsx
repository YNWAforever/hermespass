import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  dynamicParams as localeDynamicParams,
  generateStaticParams as generateLocaleParams,
} from "@/app/[locale]/layout";
import {
  dynamicParams as slugDynamicParams,
  generateStaticParams as generateSlugParams,
} from "@/app/[locale]/[slug]/page";
import { ZhPage } from "@/components/marketing/zh-page";
import { ZhShell } from "@/components/marketing/zh-shell";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { convert, isZhLocale, localize } from "@/lib/i18n/locale";
import { ZH_SLUGS, zhMetadata } from "@/lib/i18n/zh-metadata";

describe("server-safe locale helpers", () => {
  it("accepts only the two supported Chinese locales", () => {
    expect(isZhLocale("zh-hans")).toBe(true);
    expect(isZhLocale("zh-hant")).toBe(true);
    expect(isZhLocale("en")).toBe(false);
    expect(isZhLocale("zh-xx")).toBe(false);
  });

  it("keeps Simplified copy unchanged and converts Traditional copy deeply", () => {
    expect(convert("简体中文", "zh-hans")).toBe("简体中文");
    expect(convert("简体中文", "zh-hant")).toBe("簡體中文");
    expect(
      localize(
        {
          title: "软件代理",
          items: ["网络", "数字护照"],
        },
        "zh-hant",
      ),
    ).toEqual({
      title: "軟體代理",
      items: ["網路", "數字護照"],
    });
  });
});

describe("Chinese route contract", () => {
  it("defines exactly 13 supported slugs and closed dynamic segments", () => {
    expect(ZH_SLUGS).toEqual([
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
    ]);
    expect(generateLocaleParams()).toEqual([{ locale: "zh-hans" }, { locale: "zh-hant" }]);
    expect(generateSlugParams()).toHaveLength(10);
    expect(localeDynamicParams).toBe(false);
    expect(slugDynamicParams).toBe(false);
  });

  it("emits locale-aware metadata for every supported slug", () => {
    for (const slug of ZH_SLUGS) {
      expect(() => zhMetadata("zh-hans", slug)).not.toThrow();
      expect(() => zhMetadata("zh-hant", slug)).not.toThrow();
    }

    expect(zhMetadata("zh-hans", "pricing")).toMatchObject({
      openGraph: { locale: "zh_CN", type: "website" },
      twitter: { card: "summary_large_image" },
    });
    expect(zhMetadata("zh-hant", "pricing")).toMatchObject({
      openGraph: { locale: "zh_HK", type: "website" },
      twitter: { card: "summary_large_image" },
    });
  });

  it("turns unsupported locales and slugs into not-found errors", () => {
    expect(() => zhMetadata("zh-xx", "index")).toThrow();
    expect(() => zhMetadata("zh-hans", "unknown")).toThrow();
  });

  it("renders Traditional Chinese and resolved language-switcher links", () => {
    render(
      <LocaleProvider locale="zh-hant">
        <ZhPage slug="index" />
      </LocaleProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /讓每一個 AI 智慧體都擁有可驗證的數字護照/,
      }),
    ).toBeInTheDocument();

    render(
      <LocaleProvider locale="zh-hans">
        <ZhShell>
          <p>内容</p>
        </ZhShell>
      </LocaleProvider>,
    );

    expect(screen.getAllByRole("link", { name: "EN" })[0]).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "繁體" })[0]).toHaveAttribute("href", "/zh-hant");
    expect(screen.getAllByRole("link", { name: "简体" })[0]).toHaveAttribute("href", "/zh-hans");
  });
});
