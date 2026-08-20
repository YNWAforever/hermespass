"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requestJson } from "@/lib/agents/client";
import type { ApprovalDecision, ApprovalDto } from "@/lib/approvals/service";
import { GATEWAY_POLL_INTERVAL_MS } from "@/lib/gateway/client";

export function useApprovals(polling: boolean) {
  return useQuery({
    queryKey: ["approvals"],
    queryFn: () => requestJson<{ approvals: ApprovalDto[] }>("/api/approvals"),
    refetchInterval: polling ? GATEWAY_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useResolveApproval() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: ApprovalDecision;
      reason: string;
    }) =>
      requestJson(`/api/approvals/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["approvals"] }),
        client.invalidateQueries({ queryKey: ["gateway", "activity"] }),
        client.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}
