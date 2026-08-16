"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { HermesProvider } from "@/lib/hermes-store";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <HermesProvider>
        {children}
        <Toaster />
      </HermesProvider>
    </QueryClientProvider>
  );
}
