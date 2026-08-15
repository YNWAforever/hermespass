import { createFileRoute } from "@tanstack/react-router";
import { ZhPage } from "@/components/marketing/zh-page";
import { zhHead } from "@/lib/i18n/zh-head";

export const Route = createFileRoute("/$locale/product")({
  head: ({ params }) => zhHead(params.locale, "product"),
  component: () => <ZhPage slug="product" />,
});
