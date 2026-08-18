"use client";

import { useQuery } from "@tanstack/react-query";

import { requestJson } from "@/lib/agents/client";
import type { GatewayActivityResponse } from "@/lib/gateway/activity-types";

export const GATEWAY_POLL_INTERVAL_MS = 3_000;

export function useGatewayActivity(polling: boolean) {
  return useQuery({
    queryKey: ["gateway", "activity"],
    queryFn: () => requestJson<GatewayActivityResponse>("/api/gateway/activity"),
    refetchInterval: polling ? GATEWAY_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}
