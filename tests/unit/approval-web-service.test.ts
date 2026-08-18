import { describe, expect, it } from "vitest";

import {
  listApprovals,
  resolveWebApproval,
  type ApprovalDto,
  type ApprovalServiceStore,
  type ApprovalResolutionTransaction,
} from "@/lib/approvals/service";
import { PermissionDeniedError } from "@/lib/auth/errors";

const actorBase = {
  userId: "reviewer-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Test org",
  organizationSlug: "test-org",
  email: "reviewer@example.com",
  name: "Reviewer",
};
const approvalId = "22222222-2222-4222-8222-222222222222";
const gatewayRequestId = "33333333-3333-4333-8333-333333333333";

const approval: ApprovalDto = {
  id: approvalId,
  gatewayRequestId,
  agentId: "44444444-4444-4444-8444-444444444444",
  agentName: "Procurement agent",
  agentDid: "did:web:test:agents:procurement",
  tool: "vendor.contract",
  summary: "Approve the signed request digest",
  amountCents: 25_000,
  currency: "HKD",
  merchantCategoryCode: "7399",
  requestDigest: "digest",
  keyThumbprint: "thumbprint",
  policyVersion: 7,
  assignedReviewerUserId: "reviewer-1",
  assignedReviewerName: "Reviewer",
  assignedReviewerEmail: "reviewer@example.com",
  status: "pending",
  resolution: null,
  resolutionSource: null,
  resolutionReason: null,
  resolvedAt: null,
  expiresAt: "2026-08-18T08:00:00.000Z",
  authorizationExpiresAt: null,
  telegramDeliveryState: "not_requested",
  telegramDeliveryAttempts: 0,
  telegramLastAttemptAt: null,
  telegramDeliveredAt: null,
  telegramLastErrorCode: null,
  createdAt: "2026-08-18T04:00:00.000Z",
};

class FakeTransaction implements ApprovalResolutionTransaction {
  sources: string[] = [];

  async resolve(input: Parameters<ApprovalResolutionTransaction["resolve"]>[0]) {
    this.sources.push(input.source);
    return {
      approvalId,
      gatewayRequestId,
      status: input.decision === "allow" ? ("approved" as const) : ("denied" as const),
      decision: input.decision,
    };
  }
}

function fakeStore() {
  const transaction = new FakeTransaction();
  const listCalls: Array<{ actorUserId: string; organizationId: string }> = [];
  const store: ApprovalServiceStore = {
    list: async (actorUserId, organizationId) => {
      listCalls.push({ actorUserId, organizationId });
      return [approval];
    },
    transaction: async (_actorUserId, callback) => callback(transaction),
  };
  return { store, transaction, listCalls };
}

describe("web approval service", () => {
  it("lists through the verified membership identity and tenant", async () => {
    const { store, listCalls } = fakeStore();
    const actor = { ...actorBase, role: "admin" as const };

    await expect(listApprovals(actor, store)).resolves.toEqual([approval]);
    expect(listCalls).toEqual([
      { actorUserId: actor.userId, organizationId: actor.organizationId },
    ]);
  });

  it("uses web for admins and owner_override for owners", async () => {
    const first = fakeStore();
    await resolveWebApproval(
      { ...actorBase, role: "admin" },
      { approvalId, decision: "deny", reason: "Request was not approved." },
      first.store,
    );
    expect(first.transaction.sources).toEqual(["web"]);

    const second = fakeStore();
    await resolveWebApproval(
      { ...actorBase, role: "owner" },
      { approvalId, decision: "allow", reason: "Owner reviewed the signed digest." },
      second.store,
    );
    expect(second.transaction.sources).toEqual(["owner_override"]);
  });

  it("rejects viewers before opening a resolution transaction", async () => {
    const { store, transaction } = fakeStore();

    await expect(
      resolveWebApproval(
        { ...actorBase, role: "viewer" },
        { approvalId, decision: "deny", reason: "No." },
        store,
      ),
    ).rejects.toEqual(expect.any(PermissionDeniedError));
    expect(transaction.sources).toEqual([]);
  });
});
