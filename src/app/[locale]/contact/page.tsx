import type { Metadata } from "next";

import { ZhContactPage } from "@/components/marketing/zh-contact";
import { zhMetadata } from "@/lib/i18n/zh-metadata";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  return zhMetadata(locale, "contact");
}

export default function ChineseContactPage() {
  return <ZhContactPage />;
}
