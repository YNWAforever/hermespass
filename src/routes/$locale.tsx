import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { isZhLocale } from "@/lib/i18n/locale";

export const Route = createFileRoute("/$locale")({
  beforeLoad: ({ params }) => {
    if (!isZhLocale(params.locale)) throw notFound();
  },
  component: LocaleLayout,
});

function LocaleLayout() {
  const { locale } = Route.useParams();
  return (
    <LocaleProvider locale={isZhLocale(locale) ? locale : "zh-hans"}>
      <Outlet />
    </LocaleProvider>
  );
}
