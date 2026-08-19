import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  assertCanMutate: vi.fn((current: { role: string }) => {
    if (current.role === "viewer") throw new Error("PERMISSION_DENIED");
  }),
  withActorTransaction: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => authMocks);
import type { Actor } from "@/lib/auth/authorization";
import { createInsuranceService, type InsuranceServicePorts } from "@/lib/insurance/service";

const actor: Actor = {
  userId: "owner-1",
  email: "owner@example.com",
  name: "Owner",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Org",
  organizationSlug: "org",
  role: "owner",
};

const context = {
  organizationId: actor.organizationId,
  agentId: "22222222-2222-4222-8222-222222222222",
  did: "did:web:hermespass.asia:agent:demo",
  riskTier: "medium" as const,
  status: "active" as const,
  expiresAt: "2099-01-01T00:00:00.000Z",
};

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    agentId: context.agentId,
    version: 1,
    insurer: "mock",
    riskTier: "medium",
    status: "quoted",
    coverageCents: 200000000,
    premiumCents: 25000,
    commissionBps: 2000,
    insurerQuoteId: "mockq_demo",
    insurerPolicyId: null,
    quotedAt: "2026-08-20T00:00:00.000Z",
    boundAt: null,
    expiresAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("insurance service", () => {
  it("derives organization and risk from the server context before quoting", async () => {
    const tx = {};
    const withActorTransaction = vi.fn(
      async (_actor: Actor, callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    ) as unknown as InsuranceServicePorts["withActorTransaction"];
    const getAgentContext = vi.fn().mockResolvedValue(context);
    const insertQuote = vi.fn().mockResolvedValue(policyRow());
    const quote = vi.fn().mockResolvedValue({
      insurer: "mock",
      insurerQuoteId: "mockq_demo",
      coverageCents: 200000000,
      premiumCents: 25000,
      expiresAt: "2026-08-27T00:00:00.000Z",
    });
    const service = createInsuranceService({
      withActorTransaction,
      getAgentContext,
      insertQuote,
      listPolicies: vi.fn(),
      adapter: { name: "mock", quote, bind: vi.fn() },
    });

    const result = await service.quote(actor, context.agentId);

    expect(result).toMatchObject({
      agentId: context.agentId,
      riskTier: "medium",
      premiumCents: 25000,
    });
    expect(getAgentContext).toHaveBeenCalledWith(tx, context.agentId);
    expect(quote).toHaveBeenCalledWith({
      agentDid: context.did,
      riskTier: "medium",
      idempotencyKey: `insurance-quote:${context.agentId}`,
    });
    expect(insertQuote).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: actor.organizationId,
        agentId: context.agentId,
        insurerQuoteId: "mockq_demo",
      }),
    );
    expect(JSON.stringify(insertQuote.mock.calls[0]?.[1])).not.toContain("organizationName");
  });

  it("rejects viewers before opening a transaction", async () => {
    const withActorTransaction =
      vi.fn() as unknown as InsuranceServicePorts["withActorTransaction"];
    const service = createInsuranceService({
      withActorTransaction,
      getAgentContext: vi.fn(),
      insertQuote: vi.fn(),
      listPolicies: vi.fn(),
      adapter: { name: "mock", quote: vi.fn(), bind: vi.fn() },
    });
    await expect(service.quote({ ...actor, role: "viewer" }, context.agentId)).rejects.toThrow();
    expect(withActorTransaction).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant or missing agent without calling the insurer", async () => {
    const adapter = { name: "mock" as const, quote: vi.fn(), bind: vi.fn() };
    const service = createInsuranceService({
      withActorTransaction: vi.fn(async (_actor, callback) =>
        callback({}),
      ) as unknown as InsuranceServicePorts["withActorTransaction"],
      getAgentContext: vi.fn().mockResolvedValue(null),
      insertQuote: vi.fn(),
      listPolicies: vi.fn(),
      adapter,
    });
    await expect(service.quote(actor, context.agentId)).rejects.toThrow("AGENT_NOT_FOUND");
    expect(adapter.quote).not.toHaveBeenCalled();
  });

  it("maps list rows to the safe policy DTO", async () => {
    const tx = {};
    const service = createInsuranceService({
      withActorTransaction: vi.fn(async (_actor, callback) =>
        callback(tx),
      ) as unknown as InsuranceServicePorts["withActorTransaction"],
      getAgentContext: vi.fn(),
      insertQuote: vi.fn(),
      listPolicies: vi.fn().mockResolvedValue([policyRow()]),
      adapter: { name: "mock", quote: vi.fn(), bind: vi.fn() },
    });
    await expect(service.listPolicies(actor, null, 20)).resolves.toEqual([
      expect.objectContaining({ insurer: "mock", riskTier: "medium", premiumCents: 25000 }),
    ]);
  });
});
