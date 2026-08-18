import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActorProvider } from "@/components/auth/actor-context";
import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import type { Actor } from "@/lib/auth/authorization";
import type { ApprovalDto } from "@/lib/approvals/service";
import type { GatewayActivityItem } from "@/lib/gateway/activity-types";
import { HermesProvider } from "@/lib/hermes-store";

const requestId = "10000000-0000-4000-8000-000000000001";
const approvalId = "30000000-0000-4000-8000-000000000001";
const activityItem: GatewayActivityItem = {
  id: requestId,
  agentId: "20000000-0000-4000-8000-000000000001",
  agentSlug: "fimmick-merchant-concierge",
  agentName: "Fimmick Merchant Concierge",
  agentDid: "did:web:hermespass.asia:agent:fimmick-merchant-concierge",
  timestamp: "2026-08-18T04:03:02.000Z",
  tool: "refund.issue",
  summary: "Authorization boundary request",
  amountCents: 82_000,
  currency: "HKD",
  decision: "hold" as const,
  reason: "Approval threshold exceeded.",
  requestDigest: "request-digest",
  keyThumbprint: "key-thumbprint",
  policyVersion: 7,
  approvalId,
  approvalStatus: "pending" as const,
  assignedReviewerUserId: "reviewer-1",
  assignedReviewerName: "Ada Reviewer",
  assignedReviewerEmail: "ada@example.com",
  authorizationExpiresAt: null,
  telegramDeliveryState: "sent" as const,
};
const pendingApproval: ApprovalDto = {
  id: approvalId,
  gatewayRequestId: requestId,
  agentId: activityItem.agentId,
  agentName: activityItem.agentName,
  agentDid: activityItem.agentDid,
  tool: activityItem.tool,
  summary: activityItem.summary,
  amountCents: activityItem.amountCents,
  currency: activityItem.currency,
  merchantCategoryCode: "7399",
  requestDigest: activityItem.requestDigest,
  keyThumbprint: activityItem.keyThumbprint,
  policyVersion: activityItem.policyVersion,
  assignedReviewerUserId: "reviewer-1",
  assignedReviewerName: "Ada Reviewer",
  assignedReviewerEmail: "ada@example.com",
  status: "pending" as const,
  resolution: null,
  resolutionSource: null,
  resolutionReason: null,
  resolvedAt: null,
  expiresAt: "2026-08-18T08:03:02.000Z",
  authorizationExpiresAt: null,
  telegramDeliveryState: "sent" as const,
  telegramDeliveryAttempts: 1,
  telegramLastAttemptAt: "2026-08-18T04:03:05.000Z",
  telegramDeliveredAt: "2026-08-18T04:03:05.000Z",
  telegramLastErrorCode: null,
  createdAt: "2026-08-18T04:03:02.000Z",
};

function actor(role: Actor["role"], userId: string): Actor {
  return {
    userId,
    email: `${userId}@example.com`,
    name: userId,
    organizationId: "40000000-0000-4000-8000-000000000001",
    organizationName: "Test organization",
    organizationSlug: "test-organization",
    role,
  };
}

function mockDashboard(approval = pendingApproval, activity = activityItem) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/gateway/activity") {
      return Response.json({
        data: {
          activity: [activity],
          aggregates: {
            actionsToday: 1,
            pendingHolds: approval.status === "pending" ? 1 : 0,
            blockedSpendCents: 0,
            deniedCount: 0,
            decisionCounts: { allow: 0, hold: 1, deny: 0 },
            trend: [],
          },
        },
      });
    }
    if (url === "/api/approvals") {
      return Response.json({ data: { approvals: [approval] } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderDashboard(currentActor: Actor | null) {
  const dashboard = <ApprovalsClient />;
  return render(
    <HermesProvider>
      {currentActor ? <ActorProvider actor={currentActor}>{dashboard}</ActorProvider> : dashboard}
    </HermesProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("approval dashboard authorization", () => {
  it.each([
    ["missing actor context", null],
    ["viewer", actor("viewer", "viewer-1")],
    ["unassigned admin", actor("admin", "admin-2")],
  ] as const)("fails closed for %s", async (_label, currentActor) => {
    const user = userEvent.setup();
    mockDashboard();
    renderDashboard(currentActor);

    await user.click(
      await screen.findByRole("button", { name: /Authorization boundary request/i }),
    );

    expect(screen.getByRole("button", { name: "Approve action" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject action" })).toBeDisabled();
  });

  it("labels an owner override without attributing it to the assigned reviewer", async () => {
    const user = userEvent.setup();
    mockDashboard(
      {
        ...pendingApproval,
        status: "approved",
        resolution: "allow",
        resolutionSource: "owner_override",
        resolvedAt: "2026-08-18T04:04:02.000Z",
        authorizationExpiresAt: "2026-08-18T04:09:02.000Z",
      },
      {
        ...activityItem,
        decision: "allow",
        approvalStatus: "approved",
        authorizationExpiresAt: "2026-08-18T04:09:02.000Z",
      },
    );
    renderDashboard(actor("owner", "owner-1"));

    await user.click(
      await screen.findByRole("button", { name: /Authorization boundary request/i }),
    );

    expect(screen.getByText("Approved by organization owner override")).toBeInTheDocument();
    expect(screen.queryByText(/Approved by Ada Reviewer/i)).not.toBeInTheDocument();
  });
});
