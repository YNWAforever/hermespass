import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(async () => ({
    userId: "user-1",
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Test org",
    organizationSlug: "test-org",
    email: "member@example.com",
    name: "Member",
    role: "admin" as const,
  })),
  issueAgent: vi.fn(async () => ({ id: "agent" })),
  listAgents: vi.fn(async () => []),
  revokeAgent: vi.fn(async () => ({ id: "agent" })),
  getPublicAgent: vi.fn(async () => null),
  getPublicAgentByDid: vi.fn(async () => null),
  verifyPublicAgentByDid: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/agents/service", () => ({
  issueAgent: mocks.issueAgent,
  listAgents: mocks.listAgents,
  revokeAgent: mocks.revokeAgent,
  getPublicAgent: mocks.getPublicAgent,
  getPublicAgentByDid: mocks.getPublicAgentByDid,
  verifyPublicAgentByDid: mocks.verifyPublicAgentByDid,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
});

describe("security-sensitive route error contracts", () => {
  it("returns a normalized 400 envelope for malformed agent JSON", async () => {
    const { POST } = await import("@/app/api/agents/route");
    const request = new Request("http://localhost/api/agents", {
      method: "POST",
      body: "{not-json",
      headers: { "content-type": "application/json", "x-request-id": "req-json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "The request body must contain valid JSON.",
        requestId: "req-json",
      },
    });
    expect(mocks.issueAgent).not.toHaveBeenCalled();
  });

  it("validates revoke identifiers as UUIDs before calling the service", async () => {
    const { POST } = await import("@/app/api/agents/[id]/revoke/route");
    const request = new Request("http://localhost/api/agents/not-a-uuid/revoke", {
      method: "POST",
      headers: { "x-request-id": "req-revoke" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      code: "VALIDATION_ERROR",
      requestId: "req-revoke",
    });
    expect(mocks.revokeAgent).not.toHaveBeenCalled();
  });

  it("uses the standard error envelope for missing public DID documents", async () => {
    const { GET } = await import("@/app/agent/[slug]/did.json/route");
    const request = new Request("http://localhost/agent/missing/did.json", {
      headers: { "x-request-id": "req-did" },
    });

    const response = await GET(request, { params: Promise.resolve({ slug: "missing" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "AGENT_NOT_FOUND", message: "Agent not found.", requestId: "req-did" },
    });
  });

  it("uses the standard error envelope for invalid verification requests", async () => {
    const { GET } = await import("@/app/api/verify/route");
    const request = new Request("http://localhost/api/verify", {
      headers: { "x-request-id": "req-verify" },
    });

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "DID_REQUIRED",
        message: "A did query parameter is required.",
        requestId: "req-verify",
      },
    });
  });
});
