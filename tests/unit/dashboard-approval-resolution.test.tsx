import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActorProvider } from "@/components/auth/actor-context";
import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import { HermesProvider } from "@/lib/hermes-store";

const requestId = "10000000-0000-4000-8000-000000000001";
const approvalId = "30000000-0000-4000-8000-000000000001";
const reviewerActor = {
  userId: "reviewer-1",
  email: "ada@example.com",
  name: "Ada Reviewer",
  organizationId: "40000000-0000-4000-8000-000000000001",
  organizationName: "Test organization",
  organizationSlug: "test-organization",
  role: "admin" as const,
};

const activity = {
  activity: [
    {
      id: requestId,
      agentId: "20000000-0000-4000-8000-000000000001",
      agentSlug: "fimmick-merchant-concierge",
      agentName: "Fimmick Merchant Concierge",
      agentDid: "did:web:hermespass.asia:agent:fimmick-merchant-concierge",
      timestamp: "2026-08-18T04:03:02.000Z",
      tool: "refund.issue",
      summary: "Approval mutation request",
      amountCents: 82_000,
      currency: "HKD",
      decision: "hold",
      reason: "Approval threshold exceeded.",
      requestDigest: "request-digest",
      keyThumbprint: "key-thumbprint",
      policyVersion: 7,
      approvalId,
      approvalStatus: "pending",
      assignedReviewerUserId: "reviewer-1",
      assignedReviewerName: "Ada Reviewer",
      assignedReviewerEmail: "ada@example.com",
      authorizationExpiresAt: null,
      telegramDeliveryState: "sent",
    },
  ],
  aggregates: {
    actionsToday: 1,
    pendingHolds: 1,
    blockedSpendCents: 0,
    deniedCount: 0,
    decisionCounts: { allow: 0, hold: 1, deny: 0 },
    trend: [],
  },
};
const approval = {
  id: approvalId,
  gatewayRequestId: requestId,
  agentId: activity.activity[0]!.agentId,
  agentName: activity.activity[0]!.agentName,
  agentDid: activity.activity[0]!.agentDid,
  tool: "refund.issue",
  summary: "Approval mutation request",
  amountCents: 82_000,
  currency: "HKD",
  merchantCategoryCode: "7399",
  requestDigest: "request-digest",
  keyThumbprint: "key-thumbprint",
  policyVersion: 7,
  assignedReviewerUserId: "reviewer-1",
  assignedReviewerName: "Ada Reviewer",
  assignedReviewerEmail: "ada@example.com",
  status: "pending",
  resolution: null,
  resolutionSource: null,
  resolutionReason: null,
  resolvedAt: null,
  expiresAt: "2026-08-18T08:03:02.000Z",
  authorizationExpiresAt: null,
  telegramDeliveryState: "sent",
  telegramDeliveryAttempts: 1,
  telegramLastAttemptAt: "2026-08-18T04:03:05.000Z",
  telegramDeliveredAt: "2026-08-18T04:03:05.000Z",
  telegramLastErrorCode: null,
  createdAt: "2026-08-18T04:03:02.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live approval resolution", () => {
  it("posts only the decision and reviewer reason to the protected resolution API", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/gateway/activity") {
        return Response.json({ data: activity });
      }
      if (url === "/api/approvals") {
        return Response.json({ data: { approvals: [approval] } });
      }
      if (url === `/api/approvals/${approvalId}/resolve` && init?.method === "POST") {
        return Response.json({
          data: {
            approval: {
              approvalId,
              gatewayRequestId: requestId,
              status: "approved",
              decision: "allow",
              source: "web",
            },
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(
      <HermesProvider>
        <ActorProvider actor={reviewerActor}>
          <ApprovalsClient />
        </ActorProvider>
      </HermesProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Approval mutation request/i }));
    await user.click(screen.getByRole("button", { name: "Approve action" }));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(
        ([input, init]) =>
          String(input) === `/api/approvals/${approvalId}/resolve` && init?.method === "POST",
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        decision: "allow",
        reason: "Approved from the HermesPass dashboard.",
      });
      expect(body).not.toHaveProperty("source");
      expect(body).not.toHaveProperty("actorUserId");
    });
  });
});
