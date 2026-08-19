import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireActor: vi.fn(),
  createOrganization: vi.fn(),
  createInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/orgs/service", () => ({ createOrganization: mocks.createOrganization }));
vi.mock("@/lib/invites/service", () => ({
  createInvite: mocks.createInvite,
  acceptInvite: mocks.acceptInvite,
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
  mocks.getSessionUser.mockResolvedValue({ id: "user-1", email: "user@example.com", name: "User" });
  mocks.requireActor.mockResolvedValue(actor);
  mocks.createOrganization.mockResolvedValue({
    id: actor.organizationId,
    name: "Acme",
    slug: "acme",
    tier: "pilot",
    role: "owner",
  });
  mocks.createInvite.mockResolvedValue({
    id: "22222222-2222-4222-8222-222222222222",
    prefix: "AbCdEf123456",
    urlPath: "/invite/" + "A".repeat(43),
    expiresAt: "2026-08-20T05:00:00.000Z",
  });
  mocks.acceptInvite.mockResolvedValue({ organizationId: actor.organizationId, role: "viewer" });
});

describe("onboarding API contracts", () => {
  it("creates an owner organization without accepting browser-controlled role or tier", async () => {
    const { POST } = await import("@/app/api/orgs/route");
    const request = new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-org" },
      body: JSON.stringify({ name: "Acme", slug: "Acme", role: "admin", tier: "scale" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(mocks.createOrganization).toHaveBeenCalledWith(
      { userId: "user-1", email: "user@example.com", name: "User" },
      { name: "Acme", slug: "Acme" },
    );
  });

  it("returns the one-time invite path without a token hash", async () => {
    const { POST } = await import("@/app/api/invites/route");
    const response = await POST(
      new Request("http://localhost/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "teammate@example.com", role: "viewer" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: { invite: expect.objectContaining({ prefix: "AbCdEf123456" }) },
    });
    expect(JSON.stringify(mocks.createInvite.mock.calls[0])).not.toContain("tokenHash");
  });

  it("accepts only the token field and maps expired invites safely", async () => {
    const { POST } = await import("@/app/api/invites/accept/route");
    mocks.acceptInvite.mockRejectedValueOnce(new Error("INVITE_INVALID"));
    const response = await POST(
      new Request("http://localhost/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "req-accept" },
        body: JSON.stringify({ token: "A".repeat(43), organizationId: "attacker" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVITE_INVALID",
        message: "The invitation is invalid or expired.",
        requestId: "req-accept",
      },
    });
    expect(mocks.acceptInvite).toHaveBeenCalledWith(
      { userId: "user-1", email: "user@example.com" },
      "A".repeat(43),
    );
  });
});
