import { createFileRoute } from "@tanstack/react-router";
import { ZhPage } from "@/components/marketing/zh-page";
import { zhHead } from "@/lib/i18n/zh-head";

export const Route = createFileRoute("/$locale/pricing")({
  head: ({ params }) => zhHead(params.locale, "pricing"),
  component: () => <ZhPage slug="pricing" />,
});
