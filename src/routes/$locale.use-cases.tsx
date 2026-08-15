import { createFileRoute } from "@tanstack/react-router";
import { ZhPage } from "@/components/marketing/zh-page";
import { zhHead } from "@/lib/i18n/zh-head";

export const Route = createFileRoute("/$locale/use-cases")({
  head: ({ params }) => zhHead(params.locale, "use-cases"),
  component: () => <ZhPage slug="use-cases" />,
});
