"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requestJson } from "@/lib/agents/client";
import { useAgentFixtureMode } from "@/lib/agents/fixture-context";
import type { MemberDto } from "@/lib/policies/service";
import { policyInputSchema, type PolicyDto, type PolicyInput } from "@/lib/policies/types";

type MembersResponse = { members: MemberDto[] };
type PolicyResponse = { policy: PolicyDto | null };

const fixtureMembers: MembersResponse = {
  members: [
    {
      userId: "fixture-owner",
      nameSnapshot: "Fixture Owner",
      emailSnapshot: "owner@fixture.hermespass.test",
      role: "owner",
      active: true,
    },
    {
      userId: "fixture-admin",
      nameSnapshot: "Fixture Administrator",
      emailSnapshot: "admin@fixture.hermespass.test",
      role: "admin",
      active: true,
    },
  ],
};

export function useMembers(enabled = true) {
  const usesFixtureData = useAgentFixtureMode();
  return useQuery({
    queryKey: ["members"],
    queryFn: () =>
      usesFixtureData
        ? Promise.resolve(fixtureMembers)
        : requestJson<MembersResponse>("/api/members"),
    ...(usesFixtureData ? { initialData: fixtureMembers } : {}),
    enabled,
    staleTime: 30_000,
  });
}

export function useAgentPolicy(agentId: string, enabled = true) {
  const usesFixtureData = useAgentFixtureMode();
  const fixturePolicy = { policy: null } satisfies PolicyResponse;
  return useQuery({
    queryKey: ["agents", agentId, "policy"],
    queryFn: () =>
      usesFixtureData
        ? Promise.resolve(fixturePolicy)
        : requestJson<PolicyResponse>(`/api/agents/${encodeURIComponent(agentId)}/policy`),
    ...(usesFixtureData ? { initialData: fixturePolicy } : {}),
    enabled: enabled && Boolean(agentId),
    staleTime: 15_000,
  });
}

export function useSaveAgentPolicy(agentId: string) {
  const usesFixtureData = useAgentFixtureMode();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: PolicyInput) => {
      const validated = policyInputSchema.parse(input);
      if (usesFixtureData) {
        const current =
          client.getQueryData<PolicyResponse>(["agents", agentId, "policy"])?.policy ?? null;
        const now = new Date().toISOString();
        const policy: PolicyDto = {
          id: `fixture-policy-${agentId}-${(current?.version ?? 0) + 1}`,
          agentId,
          version: (current?.version ?? 0) + 1,
          ...validated,
          isActive: true,
          supersededAt: null,
          createdAt: now,
        };
        const result = { policy };
        client.setQueryData<PolicyResponse>(["agents", agentId, "policy"], result);
        return result;
      }
      return requestJson<{ policy: PolicyDto }>(
        `/api/agents/${encodeURIComponent(agentId)}/policy`,
        {
          method: "PUT",
          body: JSON.stringify(validated),
        },
      );
    },
    onSuccess: (result) => {
      client.setQueryData<PolicyResponse>(["agents", agentId, "policy"], result);
      void client.invalidateQueries({
        queryKey: ["agents", agentId, "policy"],
        ...(usesFixtureData ? { refetchType: "none" as const } : {}),
      });
      void client.invalidateQueries({
        queryKey: ["audit"],
        ...(usesFixtureData ? { refetchType: "none" as const } : {}),
      });
    },
  });
}

export type { MemberDto, PolicyDto, PolicyInput };
