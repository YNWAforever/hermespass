import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionDeniedError } from "@/lib/auth/errors";
import { policyInputSchema } from "@/lib/policies/types";

const adminActor = {
  userId: "admin-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Test org",
  organizationSlug: "test-org",
  email: "admin@example.com",
  name: "Admin",
  role: "admin" as const,
};

const policy = {
  id: "44444444-4444-4444-8444-444444444444",
  agentId: "22222222-2222-4222-8222-222222222222",
  version: 1,
  currency: "HKD" as const,
  perTransactionLimitCents: 50_000,
  dailyLimitCents: 100_000,
  monthlyLimitCents: 500_000,
  approvalThresholdCents: 20_000,
  mccAllowlist: ["5411"],
  mccRequired: true,
  assignedReviewerUserId: "reviewer-1",
  isActive: true,
  supersededAt: null,
  createdAt: "2026-08-18T01:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  createEnrollment: vi.fn(),
  consumeEnrollment: vi.fn(),
  listMembers: vi.fn(),
  getPolicy: vi.fn(),
  putPolicy: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/agents/enrollment", () => ({
  createAgentKeyEnrollment: mocks.createEnrollment,
  consumeAgentKeyEnrollment: mocks.consumeEnrollment,
}));
vi.mock("@/lib/policies/service", () => ({
  listMembers: mocks.listMembers,
  getAgentPolicy: mocks.getPolicy,
  putAgentPolicy: mocks.putPolicy,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireActor.mockResolvedValue(adminActor);
  mocks.createEnrollment.mockResolvedValue({
    token: "A".repeat(43),
    expiresAt: "2026-08-18T01:15:00.000Z",
  });
  mocks.consumeEnrollment.mockResolvedValue({
    agentId: policy.agentId,
    keyId: "55555555-5555-4555-8555-555555555555",
    keyFragment: "key-thumbprint",
    thumbprint: "thumbprint",
  });
  mocks.listMembers.mockResolvedValue([
    {
      userId: "reviewer-1",
      nameSnapshot: "Reviewer",
      emailSnapshot: "reviewer@example.com",
      role: "admin",
      active: true,
    },
  ]);
  mocks.getPolicy.mockResolvedValue(policy);
  mocks.putPolicy.mockImplementation(async (_actor, _agentId, input) => {
    policyInputSchema.parse(input);
    return policy;
  });
});

describe("Task 3 API contracts", () => {
  it("returns a one-time enrollment token without a hash", async () => {
    const { POST } = await import("@/app/api/agents/[id]/enrollment/route");
    const request = new Request(`http://localhost/api/agents/${policy.agentId}/enrollment`, {
      method: "POST",
      headers: { "x-request-id": "req-enroll" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: policy.agentId }) });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: { token: "A".repeat(43), expiresAt: "2026-08-18T01:15:00.000Z" },
    });
    expect(JSON.stringify(await mocks.createEnrollment.mock.results[0]?.value)).not.toContain(
      "tokenHash",
    );
  });

  it("rejects an invalid enrollment agent id with a request id", async () => {
    const { POST } = await import("@/app/api/agents/[id]/enrollment/route");
    const request = new Request("http://localhost/api/agents/not-a-uuid/enrollment", {
      method: "POST",
      headers: { "x-request-id": "req-enroll-invalid" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: "req-enroll-invalid" },
    });
    expect(mocks.createEnrollment).not.toHaveBeenCalled();
  });

  it("normalizes viewer enrollment denial without leaking database details", async () => {
    mocks.createEnrollment.mockRejectedValueOnce(new PermissionDeniedError());
    const { POST } = await import("@/app/api/agents/[id]/enrollment/route");
    const request = new Request(`http://localhost/api/agents/${policy.agentId}/enrollment`, {
      method: "POST",
      headers: { "x-request-id": "req-enroll-viewer" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: policy.agentId }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "PERMISSION_DENIED",
        message: "This organization role cannot perform that action.",
        requestId: "req-enroll-viewer",
      },
    });
  });

  it("returns a stable conflict for an inactive or expired agent", async () => {
    mocks.createEnrollment.mockRejectedValueOnce(new Error("AGENT_NOT_ENROLLABLE"));
    const { POST } = await import("@/app/api/agents/[id]/enrollment/route");
    const request = new Request(`http://localhost/api/agents/${policy.agentId}/enrollment`, {
      method: "POST",
      headers: { "x-request-id": "req-enroll-inactive" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: policy.agentId }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "AGENT_NOT_ENROLLABLE",
        message: "This agent cannot accept a key enrollment.",
        requestId: "req-enroll-inactive",
      },
    });
  });

  it("returns the same public invalid-enrollment envelope for forged or replayed input", async () => {
    mocks.consumeEnrollment.mockRejectedValueOnce(new Error("AGENT_ENROLLMENT_INVALID"));
    const { POST } = await import("@/app/api/agents/enrollment/consume/route");
    const request = new Request("http://localhost/api/agents/enrollment/consume", {
      method: "POST",
      body: JSON.stringify({ token: "unknown", publicJwk: {}, proof: "forged" }),
      headers: { "content-type": "application/json", "x-request-id": "req-proof" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "AGENT_ENROLLMENT_INVALID",
        message: "The enrollment proof is invalid or unavailable.",
        requestId: "req-proof",
      },
    });
  });

  it("returns normalized malformed JSON without calling the public service", async () => {
    const { POST } = await import("@/app/api/agents/enrollment/consume/route");
    const request = new Request("http://localhost/api/agents/enrollment/consume", {
      method: "POST",
      body: "{not-json",
      headers: { "content-type": "application/json", "x-request-id": "req-proof-json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "The request body must contain valid JSON.",
        requestId: "req-proof-json",
      },
    });
    expect(mocks.consumeEnrollment).not.toHaveBeenCalled();
  });

  it("returns only safe member snapshots", async () => {
    const { GET } = await import("@/app/api/members/route");
    const request = new Request("http://localhost/api/members", {
      headers: { "x-request-id": "req-members" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        members: [
          {
            userId: "reviewer-1",
            nameSnapshot: "Reviewer",
            emailSnapshot: "reviewer@example.com",
            role: "admin",
            active: true,
          },
        ],
      },
    });
  });

  it("validates policy input and preserves the standard request-id envelope", async () => {
    const { PUT } = await import("@/app/api/agents/[id]/policy/route");
    const request = new Request(`http://localhost/api/agents/${policy.agentId}/policy`, {
      method: "PUT",
      body: JSON.stringify({
        ...policy,
        currency: "USD",
        organizationId: "attacker-org",
      }),
      headers: { "content-type": "application/json", "x-request-id": "req-policy-invalid" },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: policy.agentId }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: "req-policy-invalid" },
    });
  });

  it("returns a safe current policy and creates the next version", async () => {
    const { GET, PUT } = await import("@/app/api/agents/[id]/policy/route");
    const getRequest = new Request(`http://localhost/api/agents/${policy.agentId}/policy`);

    const getResponse = await GET(getRequest, {
      params: Promise.resolve({ id: policy.agentId }),
    });
    const putResponse = await PUT(
      new Request(`http://localhost/api/agents/${policy.agentId}/policy`, {
        method: "PUT",
        body: JSON.stringify(policy),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: policy.agentId }) },
    );

    expect(await getResponse.json()).toEqual({ data: { policy } });
    expect(putResponse.status).toBe(201);
    expect(await putResponse.json()).toEqual({ data: { policy } });
  });

  it("normalizes viewer policy mutation denial", async () => {
    mocks.putPolicy.mockRejectedValueOnce(new PermissionDeniedError());
    const { PUT } = await import("@/app/api/agents/[id]/policy/route");
    const request = new Request(`http://localhost/api/agents/${policy.agentId}/policy`, {
      method: "PUT",
      body: JSON.stringify(policy),
      headers: { "content-type": "application/json", "x-request-id": "req-policy-viewer" },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: policy.agentId }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "PERMISSION_DENIED",
        message: "This organization role cannot perform that action.",
        requestId: "req-policy-viewer",
      },
    });
  });
});
