import type { ReactNode } from "react";

import { AppShell } from "@/components/hermes/app-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
