"use client";

import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { HermesProvider } from "@/lib/hermes-store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <HermesProvider>
      {children}
      <Toaster />
    </HermesProvider>
  );
}
