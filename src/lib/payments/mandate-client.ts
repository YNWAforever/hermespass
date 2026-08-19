"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requestJson } from "@/lib/agents/client";
import type { MandateDto } from "@/lib/payments/mandate-service";
import type { SignedMandateV1 } from "@/lib/payments/types";

export function useMandates() {
  return useQuery({
    queryKey: ["mandates"],
    queryFn: () => requestJson<{ mandates: MandateDto[] }>("/api/mandates"),
    staleTime: 15_000,
  });
}

export function useIssueMandate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signed: SignedMandateV1) =>
      requestJson<{ mandate: MandateDto }>("/api/mandates", {
        method: "POST",
        body: JSON.stringify(signed),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["mandates"] }),
        client.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}

export function useRevokeMandate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ mandate: MandateDto }>(`/api/mandates/${encodeURIComponent(id)}/revoke`, {
        method: "POST",
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["mandates"] }),
        client.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}
