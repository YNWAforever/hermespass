import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/productization/api-keys", () => ({
  createApiKey: mocks.createApiKey,
  listApiKeys: mocks.listApiKeys,
  revokeApiKey: mocks.revokeApiKey,
}));

const actor = {
  userId: "owner-1",
  email: "owner@example.com",
  name: "Owner",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Acme",
  organizationSlug: "acme",
  role: "owner" as const,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireActor.mockResolvedValue(actor);
  mocks.createApiKey.mockResolvedValue({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Verifier",
    prefix: "hp_live_1234",
    status: "active",
    createdAt: "2026-08-20T00:00:00.000Z",
    revokedAt: null,
    lastUsedAt: null,
    key: "hp_live_secret_once",
  });
  mocks.listApiKeys.mockResolvedValue([
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Verifier",
      prefix: "hp_live_1234",
      status: "active",
      createdAt: "2026-08-20T00:00:00.000Z",
      revokedAt: null,
      lastUsedAt: null,
    },
  ]);
  mocks.revokeApiKey.mockResolvedValue({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Verifier",
    prefix: "hp_live_1234",
    status: "revoked",
    createdAt: "2026-08-20T00:00:00.000Z",
    revokedAt: "2026-08-20T01:00:00.000Z",
    lastUsedAt: null,
  });
});

describe("API-key management route contracts", () => {
  it("returns the full bearer only from creation and safe fields from listing", async () => {
    const { GET, POST } = await import("@/app/api/apikeys/route");
    const createResponse = await POST(
      new Request("http://localhost/api/apikeys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "req-key-create" },
        body: JSON.stringify({ name: "Verifier", organizationId: actor.organizationId }),
      }),
    );
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual({
      data: {
        apiKey: expect.objectContaining({ key: "hp_live_secret_once" }),
      },
    });
    const listResponse = await GET(
      new Request("http://localhost/api/apikeys", { headers: { "x-request-id": "req-key-list" } }),
    );
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody).toEqual({
      data: { apiKeys: [expect.not.objectContaining({ key: expect.anything() })] },
    });
    expect(JSON.stringify(listBody)).not.toContain("hp_live_secret_once");
  });

  it("passes only actor-derived identity to creation", async () => {
    const { POST } = await import("@/app/api/apikeys/route");
    await POST(
      new Request("http://localhost/api/apikeys", {
        method: "POST",
        body: JSON.stringify({ name: "Verifier", organizationId: "attacker-org" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(mocks.createApiKey).toHaveBeenCalledWith(actor, "Verifier");
  });

  it("validates revoke IDs and keeps revocation idempotent at the service boundary", async () => {
    const { POST } = await import("@/app/api/apikeys/[id]/revoke/route");
    const invalid = await POST(
      new Request("http://localhost/api/apikeys/not-a-uuid/revoke", { method: "POST" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(invalid.status).toBe(400);
    expect(mocks.revokeApiKey).not.toHaveBeenCalled();

    const id = "22222222-2222-4222-8222-222222222222";
    const first = await POST(
      new Request("http://localhost/api/apikeys/" + id + "/revoke", { method: "POST" }),
      { params: Promise.resolve({ id }) },
    );
    const second = await POST(
      new Request("http://localhost/api/apikeys/" + id + "/revoke", { method: "POST" }),
      { params: Promise.resolve({ id }) },
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.revokeApiKey).toHaveBeenCalledTimes(2);
    expect(await second.json()).toEqual({
      data: { apiKey: expect.objectContaining({ status: "revoked" }) },
    });
  });
});
