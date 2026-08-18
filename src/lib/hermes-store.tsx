"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SEED_WALLETS, type Wallet } from "./hermes-data";

type HermesContextValue = {
  wallets: Wallet[];
  streaming: boolean;
  setStreaming: (value: boolean) => void;
  updateWallet: (agentSlug: string, patch: Partial<Wallet>) => void;
};

const HermesContext = createContext<HermesContextValue | null>(null);

export function HermesProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [wallets, setWallets] = useState<Wallet[]>(SEED_WALLETS);
  const [streaming, setStreaming] = useState(true);

  const updateWallet = useCallback((agentSlug: string, patch: Partial<Wallet>) => {
    setWallets((current) =>
      current.map((wallet) => (wallet.agentSlug === agentSlug ? { ...wallet, ...patch } : wallet)),
    );
  }, []);

  const value = useMemo<HermesContextValue>(
    () => ({ wallets, streaming, setStreaming, updateWallet }),
    [wallets, streaming, updateWallet],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HermesContext.Provider value={value}>{children}</HermesContext.Provider>
    </QueryClientProvider>
  );
}

export function useHermes() {
  const context = useContext(HermesContext);
  if (!context) throw new Error("useHermes must be used inside HermesProvider");
  return context;
}
