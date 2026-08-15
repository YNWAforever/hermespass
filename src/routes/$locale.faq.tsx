import { createFileRoute } from "@tanstack/react-router";
import { ZhPage } from "@/components/marketing/zh-page";
import { zhHead } from "@/lib/i18n/zh-head";

export const Route = createFileRoute("/$locale/faq")({
  head: ({ params }) => zhHead(params.locale, "faq"),
  component: () => <ZhPage slug="faq" />,
});
