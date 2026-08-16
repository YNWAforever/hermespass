import type { Metadata } from "next";

import { ZhRoiPage } from "@/components/marketing/zh-roi";
import { zhMetadata } from "@/lib/i18n/zh-metadata";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return zhMetadata(locale, "roi-calculator");
}

export default function ChineseRoiPage() {
  return <ZhRoiPage />;
}
