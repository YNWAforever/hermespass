import { beforeEach, describe, expect, it, vi } from "vitest";

const approvalId = "11111111-1111-4111-8111-111111111111";
const actor = {
  userId: "reviewer-1",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Review org",
  organizationSlug: "review-org",
  email: "reviewer@example.com",
  name: "Reviewer",
  role: "admin" as const,
};
const approval = {
  id: approvalId,
  gatewayRequestId: "33333333-3333-4333-8333-333333333333",
  agentId: "44444444-4444-4444-8444-444444444444",
  agentName: "Procurement agent",
  agentDid: "did:web:example.test:agents:procurement",
  tool: "vendor.contract",
  summary: "Approve the signed contract digest",
  amountCents: 25_000,
  currency: "HKD",
  merchantCategoryCode: "7399",
  requestDigest: "A".repeat(43),
  keyThumbprint: "thumbprint",
  policyVersion: 2,
  assignedReviewerUserId: actor.userId,
  assignedReviewerName: actor.name,
  assignedReviewerEmail: actor.email,
  status: "pending" as const,
  resolution: null,
  resolutionSource: null,
  resolutionReason: null,
  resolvedAt: null,
  expiresAt: "2026-08-18T08:00:00.000Z",
  authorizationExpiresAt: null,
  telegramDeliveryState: "failed" as const,
  telegramDeliveryAttempts: 1,
  telegramLastAttemptAt: "2026-08-18T04:05:00.000Z",
  telegramDeliveredAt: null,
  telegramLastErrorCode: "TELEGRAM_TIMEOUT",
  createdAt: "2026-08-18T04:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  listApprovals: vi.fn(),
  resolveWebApproval: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/approvals/service", () => ({
  listApprovals: mocks.listApprovals,
  resolveWebApproval: mocks.resolveWebApproval,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireActor.mockResolvedValue(actor);
  mocks.listApprovals.mockResolvedValue([approval]);
  mocks.resolveWebApproval.mockResolvedValue({
    approvalId,
    gatewayRequestId: approval.gatewayRequestId,
    status: "approved",
    decision: "allow",
    source: "web",
  });
});

describe("protected approval APIs", () => {
  it("lists only safe approval fields in the standard data envelope", async () => {
    const { GET } = await import("@/app/api/approvals/route");
    const request = new Request("http://localhost/api/approvals");

    const response = await GET(request);

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { approvals: [approval] } });
    expect(mocks.listApprovals).toHaveBeenCalledWith(actor);
    expect(JSON.stringify(body)).not.toContain("privateJwk");
  });

  it("derives the web source server-side and rejects client-supplied authority", async () => {
    const { POST } = await import("@/app/api/approvals/[id]/resolve/route");
    const request = new Request(`http://localhost/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        decision: "allow",
        reason: "Reviewed against the signed request digest.",
        source: "owner_override",
        actorUserId: "attacker",
      }),
      headers: { "content-type": "application/json", "x-request-id": "req-resolution" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: approvalId }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: "req-resolution" },
    });
    expect(mocks.resolveWebApproval).not.toHaveBeenCalled();
  });

  it("resolves from the authenticated actor with the exact envelope", async () => {
    const { POST } = await import("@/app/api/approvals/[id]/resolve/route");
    const request = new Request(`http://localhost/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        decision: "allow",
        reason: "Reviewed against the signed request digest.",
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request, { params: Promise.resolve({ id: approvalId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        approval: {
          approvalId,
          gatewayRequestId: approval.gatewayRequestId,
          status: "approved",
          decision: "allow",
          source: "web",
        },
      },
    });
    expect(mocks.resolveWebApproval).toHaveBeenCalledWith(actor, {
      approvalId,
      decision: "allow",
      reason: "Reviewed against the signed request digest.",
    });
  });
});
