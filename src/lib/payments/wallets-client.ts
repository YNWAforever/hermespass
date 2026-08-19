"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requestJson, useAgents } from "@/lib/agents/client";
import type { PolicyDto } from "@/lib/policies/types";
import type { WalletCardDto } from "@/lib/payments/card-service";

export const PAYMENT_WALLETS_QUERY_KEY = ["payment-wallets"] as const;

export function useWalletCards() {
  return useQuery({
    queryKey: PAYMENT_WALLETS_QUERY_KEY,
    queryFn: () => requestJson<{ cards: WalletCardDto[] }>("/api/wallets"),
    staleTime: 10_000,
  });
}

export function useWalletAgents() {
  return useAgents();
}

export function useWalletAgentPolicy(agentId: string, enabled = true) {
  return useQuery({
    queryKey: ["agent-policy", agentId],
    queryFn: () =>
      requestJson<{ policy: PolicyDto | null }>(
        `/api/agents/${encodeURIComponent(agentId)}/policy`,
      ),
    enabled: enabled && Boolean(agentId),
    staleTime: 15_000,
  });
}

export function useProvisionCard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      requestJson<{ card: WalletCardDto }>("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ agentId }),
      }),
    onSuccess: async (_result, agentId) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: PAYMENT_WALLETS_QUERY_KEY }),
        client.invalidateQueries({ queryKey: ["agents"] }),
        client.invalidateQueries({ queryKey: ["agent-policy", agentId] }),
        client.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}

export function useSetWalletStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "frozen" }) =>
      requestJson<{ card: WalletCardDto }>(`/api/wallets/${encodeURIComponent(id)}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: PAYMENT_WALLETS_QUERY_KEY }),
        client.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}
