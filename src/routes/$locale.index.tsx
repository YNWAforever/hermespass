import { createFileRoute } from "@tanstack/react-router";
import { ZhPage } from "@/components/marketing/zh-page";
import { zhHead } from "@/lib/i18n/zh-head";

export const Route = createFileRoute("/$locale/")({
  head: ({ params }) => zhHead(params.locale, "index"),
  component: () => <ZhPage slug="index" />,
});
