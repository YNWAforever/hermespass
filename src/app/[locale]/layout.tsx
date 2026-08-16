import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { LocaleProvider } from "@/lib/i18n/locale-context";
import { isZhLocale, ZH_LOCALES } from "@/lib/i18n/locale";

export const dynamicParams = false;

export function generateStaticParams() {
  return ZH_LOCALES.map((locale) => ({ locale }));
}

export default async function ChineseLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!isZhLocale(locale)) notFound();

  return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
}
