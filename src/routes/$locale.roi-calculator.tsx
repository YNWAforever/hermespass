import { createFileRoute } from "@tanstack/react-router";
import { ZhRoiPage } from "@/components/marketing/zh-roi";
import { zhHead } from "@/lib/i18n/zh-head";

export const Route = createFileRoute("/$locale/roi-calculator")({
  head: ({ params }) => zhHead(params.locale, "roi-calculator"),
  component: ZhRoiPage,
});
