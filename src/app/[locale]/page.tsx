import type { Metadata } from "next";

import { ZhPage } from "@/components/marketing/zh-page";
import { zhMetadata } from "@/lib/i18n/zh-metadata";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return zhMetadata(locale, "index");
}

export default function ChineseHomePage() {
  return <ZhPage slug="index" />;
}
