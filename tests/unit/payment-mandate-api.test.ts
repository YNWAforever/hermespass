import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionDeniedError } from "@/lib/auth/errors";

const adminActor = {
  userId: "admin-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Test org",
  organizationSlug: "test-org",
  email: "admin@example.com",
  name: "Admin",
  role: "admin" as const,
};

const viewerActor = { ...adminActor, userId: "viewer-1", role: "viewer" as const };

const signedMandate = {
  body: {
    version: "1",
    mandateId: "4c0c7b5b-5d2e-4e56-a03a-4cbf2464e6bc",
    agentDid: "did:web:hermespass.asia:agent:demo-agent",
    keyId: "fbb9a6a1-2d6b-4f4c-8c29-6c7c4f0a54dd",
    kind: "intent",
    nonce: "7d5b9d85-f7c8-4b94-9610-1a5c4e6a8d60",
    issuedAt: "2026-08-18T01:00:00.000Z",
    parentMandateId: null,
    constraints: {
      currency: "HKD",
      maxAmountCents: 50_000,
      merchant: "AWS",
      mccAllowlist: ["5734", "7372"],
      expiresAt: "2026-09-18T01:00:00.000Z",
      oneTime: false,
    },
  },
  signature: "s".repeat(86),
};

const mandate = {
  id: signedMandate.body.mandateId,
  agentDid: signedMandate.body.agentDid,
  kind: "intent" as const,
  status: "active" as const,
  currency: "HKD",
  maxAmountCents: 50_000,
  merchant: "AWS",
  mccAllowlist: ["5734", "7372"],
  parentMandateId: null,
  issuedAt: signedMandate.body.issuedAt,
  expiresAt: signedMandate.body.constraints.expiresAt,
  oneTime: false,
  bodyDigest: "digest",
};

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  issueMandate: vi.fn(),
  listMandates: vi.fn(),
  revokeMandate: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({
  requireActor: mocks.requireActor,
  assertCanMutate: (actor: { role: string }) => {
    if (actor.role === "viewer") throw new PermissionDeniedError();
  },
}));
vi.mock("@/lib/payments/mandate-service", () => ({
  issueMandate: mocks.issueMandate,
  listMandates: mocks.listMandates,
  revokeMandate: mocks.revokeMandate,
}));

function post(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/mandates", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-request-id": "req-mandate", ...headers },
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireActor.mockResolvedValue(adminActor);
  mocks.issueMandate.mockResolvedValue(mandate);
  mocks.listMandates.mockResolvedValue([mandate]);
  mocks.revokeMandate.mockResolvedValue({
    ...mandate,
    status: "revoked",
    revokedAt: "2026-08-18T02:00:00.000Z",
  });
});

describe("Phase 3 mandate API contracts", () => {
  it("returns the standard validation envelope and request id", async () => {
    const { POST } = await import("@/app/api/mandates/route");
    const response = await POST(post({ version: "1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: "req-mandate" },
    });
    expect(mocks.issueMandate).not.toHaveBeenCalled();
  });

  it("rejects body bytes over 16 KiB before parsing", async () => {
    const { POST } = await import("@/app/api/mandates/route");
    const response = await POST(
      post("x".repeat(16 * 1_024 + 1), { "content-length": String(16 * 1_024 + 1) }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "REQUEST_TOO_LARGE", requestId: "req-mandate" },
    });
    expect(mocks.issueMandate).not.toHaveBeenCalled();
  });

  it.each(["unknown", "bad-key", "inactive"])(
    "normalizes %s agent authentication failures",
    async (failure) => {
      mocks.issueMandate.mockRejectedValueOnce(new Error("AGENT_AUTH_FAILED"));
      const { POST } = await import("@/app/api/mandates/route");
      const response = await POST(
        post({ ...signedMandate, signature: `${failure}${"s".repeat(80)}` }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "AGENT_AUTH_FAILED", requestId: "req-mandate" },
      });
    },
  );

  it("returns a safe mandate DTO without signature or raw body", async () => {
    const { POST } = await import("@/app/api/mandates/route");
    const response = await POST(post(signedMandate));
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data.mandate).toMatchObject({ kind: "intent", status: "active", currency: "HKD" });
    expect(json.data.mandate).not.toHaveProperty("signature");
    expect(json.data.mandate).not.toHaveProperty("body");
    expect(json.data.mandate).not.toHaveProperty("publicJwk");
  });

  it("returns an idempotent stored mandate for an identical signed nonce", async () => {
    mocks.issueMandate.mockResolvedValueOnce({ ...mandate, replayed: true });
    const { POST } = await import("@/app/api/mandates/route");
    const response = await POST(post(signedMandate));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { mandate: { id: mandate.id } } });
  });

  it("returns a conflict for a nonce bound to different signed bytes", async () => {
    mocks.issueMandate.mockRejectedValueOnce(new Error("NONCE_CONFLICT"));
    const { POST } = await import("@/app/api/mandates/route");
    const response = await POST(post(signedMandate));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "NONCE_CONFLICT", requestId: "req-mandate" },
    });
  });

  it("normalizes an invalid parent as a safe conflict", async () => {
    mocks.issueMandate.mockRejectedValueOnce(new Error("MANDATE_PARENT_INVALID"));
    const { POST } = await import("@/app/api/mandates/route");
    const response = await POST(post(signedMandate));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "MANDATE_PARENT_INVALID", requestId: "req-mandate" },
    });
  });

  it("lists only safe rows through the signed-in organization actor", async () => {
    const { GET } = await import("@/app/api/mandates/route");
    const response = await GET(
      new Request("http://localhost/api/mandates", { headers: { "x-request-id": "req-list" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { mandates: [mandate] } });
    expect(mocks.listMandates).toHaveBeenCalledWith(adminActor);
  });

  it("requires owner/admin for revocation and returns a viewer denial", async () => {
    mocks.requireActor.mockResolvedValueOnce(viewerActor);
    const { POST } = await import("@/app/api/mandates/[id]/revoke/route");
    const response = await POST(
      new Request(`http://localhost/api/mandates/${mandate.id}/revoke`, {
        method: "POST",
        headers: { "x-request-id": "req-revoke-viewer" },
      }),
      { params: Promise.resolve({ id: mandate.id }) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "PERMISSION_DENIED", requestId: "req-revoke-viewer" },
    });
    expect(mocks.revokeMandate).not.toHaveBeenCalled();
  });

  it("keeps revocation idempotent and returns the existing state", async () => {
    const { POST } = await import("@/app/api/mandates/[id]/revoke/route");
    const response = await POST(
      new Request(`http://localhost/api/mandates/${mandate.id}/revoke`, {
        method: "POST",
        headers: { "x-request-id": "req-revoke" },
      }),
      { params: Promise.resolve({ id: mandate.id }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { mandate: { id: mandate.id, status: "revoked" } },
    });
  });
});
