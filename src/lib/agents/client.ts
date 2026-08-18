"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { buildChain, SEED_AGENTS, SEED_EVENTS } from "@/lib/hermes-data";
import { useAgentFixtureMode } from "@/lib/agents/fixture-context";
import type { AgentDto } from "@/lib/agents/types";

export type ApiError = Error & {
  code?: string | undefined;
  fieldErrors?: Record<string, string[]> | undefined;
};

export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as {
    data?: T;
    error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
  };
  if (!response.ok || body.data === undefined) {
    const error = new Error(body.error?.message ?? "Request failed") as ApiError;
    error.code = body.error?.code;
    error.fieldErrors = body.error?.fieldErrors;
    throw error;
  }
  return body.data;
}

const testAgentData = {
  agents: SEED_AGENTS.map((agent) => ({
    ...agent,
    databaseId: agent.id,
    orgSlug: "test-org",
    credentialId: `urn:uuid:${agent.slug}`,
    credentialJws: "",
    governanceNotes: null,
    keyStatus: "active" as const,
    keyCustody: "legacy_encrypted" as const,
  })) as AgentDto[],
};
const testAuditData = {
  entries: buildChain(SEED_EVENTS).map((entry) => ({
    id: entry.index,
    timestamp: entry.timestamp,
    agentDid: entry.agentSlug,
    agentSlug: entry.agentSlug,
    action: entry.action,
    summary: entry.action,
    payloadHash: entry.payloadHash,
    previousHash: entry.prevHash,
    decision: entry.decision,
    tool: entry.action,
  })),
};

export function useAgents() {
  const usesFixtureData = useAgentFixtureMode();
  return useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      usesFixtureData
        ? Promise.resolve(testAgentData)
        : requestJson<{ agents: AgentDto[] }>("/api/agents"),
    ...(usesFixtureData ? { initialData: testAgentData } : {}),
    staleTime: 15_000,
  });
}

export function useIssueAgent() {
  const client = useQueryClient();
  const usesFixtureData = useAgentFixtureMode();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      role: string;
      risk: "low" | "medium" | "high";
      scopes: string[];
      spendCap: number;
      governanceNotes: string | null;
    }) => {
      if (usesFixtureData) {
        const current = client.getQueryData<{ agents: AgentDto[] }>(["agents"])?.agents ?? [];
        const slugBase =
          input.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "agent";
        const slug = `${slugBase}-test`;
        const issued = new Date();
        const expires = new Date(issued);
        expires.setUTCFullYear(expires.getUTCFullYear() + 1);
        const agent: AgentDto = {
          databaseId: `test-${current.length + 1}`,
          id: `did:web:hermespass.asia:agent:${slug}`,
          slug,
          name: input.name,
          role: input.role,
          org: "Current organisation",
          orgSlug: "test-org",
          status: "active",
          risk: input.risk,
          scopes: input.scopes,
          spendCap: input.spendCap,
          issued: issued.toISOString().slice(0, 10),
          expires: expires.toISOString().slice(0, 10),
          keyStatus: "enrollment_required",
          keyCustody: null,
          thumbprint: null,
          publicKey: null,
          credentialId: `urn:uuid:test-${current.length + 1}`,
          credentialJws: "",
          governanceNotes: input.governanceNotes,
        };
        client.setQueryData<{ agents: AgentDto[] }>(["agents"], { agents: [agent, ...current] });
        return { agent };
      }
      return requestJson<{ agent: AgentDto }>("/api/agents", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["agents"],
        ...(usesFixtureData ? { refetchType: "none" as const } : {}),
      });
      void client.invalidateQueries({
        queryKey: ["audit"],
        ...(usesFixtureData ? { refetchType: "none" as const } : {}),
      });
    },
  });
}

export type EnrollmentTokenDto = {
  token: string;
  expiresAt: string;
};

export function useCreateAgentEnrollment() {
  const client = useQueryClient();
  const usesFixtureData = useAgentFixtureMode();
  return useMutation({
    mutationFn: async (agentId: string) => {
      if (usesFixtureData) {
        return {
          token: "fixture-enrollment-token",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        } satisfies EnrollmentTokenDto;
      }
      return requestJson<EnrollmentTokenDto>(
        `/api/agents/${encodeURIComponent(agentId)}/enrollment`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["agents"],
        ...(usesFixtureData ? { refetchType: "none" as const } : {}),
      });
      void client.invalidateQueries({
        queryKey: ["audit"],
        ...(usesFixtureData ? { refetchType: "none" as const } : {}),
      });
    },
  });
}

export function useRevokeAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ agent: AgentDto }>(`/api/agents/${encodeURIComponent(id)}/revoke`, {
        method: "POST",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["agents"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export type AuditEntry = (typeof testAuditData)["entries"][number];

export function useAudit() {
  const usesFixtureData = useAgentFixtureMode();
  return useQuery({
    queryKey: ["audit"],
    queryFn: () =>
      usesFixtureData
        ? Promise.resolve(testAuditData)
        : requestJson<{ entries: AuditEntry[] }>("/api/audit"),
    ...(usesFixtureData ? { initialData: testAuditData } : {}),
    staleTime: 15_000,
  });
}

export type AuditVerification = {
  valid: boolean;
  checked: number;
  firstInvalid: number | null;
};

export function useAuditVerification() {
  const usesFixtureData = useAgentFixtureMode();
  return useQuery({
    queryKey: ["audit", "verification"],
    queryFn: () =>
      usesFixtureData
        ? Promise.resolve<AuditVerification>({
            valid: true,
            checked: testAuditData.entries.length,
            firstInvalid: null,
          })
        : requestJson<AuditVerification>("/api/audit/verify"),
    staleTime: 15_000,
  });
}
