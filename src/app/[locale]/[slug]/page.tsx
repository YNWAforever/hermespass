import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ZhPage } from "@/components/marketing/zh-page";
import { isZhLocale } from "@/lib/i18n/locale";
import { isZhStaticSlug, ZH_STATIC_SLUGS, zhMetadata } from "@/lib/i18n/zh-metadata";

export const dynamicParams = false;

export function generateStaticParams() {
  return ZH_STATIC_SLUGS.map((slug) => ({ slug }));
}

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  return zhMetadata(locale, slug);
}

export default async function ChineseStaticPage({ params }: PageProps) {
  const { locale, slug } = await params;
  if (!isZhLocale(locale) || !isZhStaticSlug(slug)) notFound();

  return <ZhPage slug={slug} />;
}
