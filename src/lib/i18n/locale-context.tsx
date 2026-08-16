"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ZhLocale } from "./locale";

const LocaleContext = createContext<ZhLocale | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: ZhLocale;
  children: ReactNode;
}): ReactNode {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): ZhLocale {
  const locale = useContext(LocaleContext);
  if (!locale) throw new Error("useLocale must be used within LocaleProvider");
  return locale;
}
