import { createFileRoute } from "@tanstack/react-router";
import { ZhContactPage } from "@/components/marketing/zh-contact";
import { zhHead } from "@/lib/i18n/zh-head";

export const Route = createFileRoute("/$locale/contact")({
  head: ({ params }) => zhHead(params.locale, "contact"),
  component: ZhContactPage,
});
