import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import { HermesProvider } from "@/lib/hermes-store";

const activityResponse = {
  activity: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      agentId: "20000000-0000-4000-8000-000000000001",
      agentSlug: "fimmick-merchant-concierge",
      agentName: "Fimmick Merchant Concierge",
      agentDid: "did:web:hermespass.asia:agent:fimmick-merchant-concierge",
      timestamp: "2026-08-18T04:03:02.000Z",
      tool: "refund.issue",
      summary: "Live refund request for Order #LIVE-42",
      amountCents: 82_000,
      currency: "HKD",
      decision: "hold",
      reason: "Approval threshold exceeded.",
      requestDigest: "request-digest-live-42",
      keyThumbprint: "key-thumbprint-live-42",
      policyVersion: 7,
      approvalId: "30000000-0000-4000-8000-000000000001",
      approvalStatus: "pending",
      assignedReviewerUserId: "reviewer-1",
      assignedReviewerName: "Ada Reviewer",
      assignedReviewerEmail: "ada@example.com",
      authorizationExpiresAt: null,
      telegramDeliveryState: "sent",
    },
  ],
  aggregates: {
    actionsToday: 42,
    pendingHolds: 1,
    blockedSpendCents: 2_640_000,
    deniedCount: 1,
    decisionCounts: { allow: 40, hold: 1, deny: 1 },
    trend: [{ hour: "04:00", allow: 40, hold: 1, deny: 1 }],
  },
};

const approvalsResponse = {
  approvals: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      gatewayRequestId: "10000000-0000-4000-8000-000000000001",
      agentId: "20000000-0000-4000-8000-000000000001",
      agentName: "Fimmick Merchant Concierge",
      agentDid: "did:web:hermespass.asia:agent:fimmick-merchant-concierge",
      tool: "refund.issue",
      summary: "Live refund request for Order #LIVE-42",
      amountCents: 82_000,
      currency: "HKD",
      merchantCategoryCode: "7399",
      requestDigest: "request-digest-live-42",
      keyThumbprint: "key-thumbprint-live-42",
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
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live dashboard gateway data", () => {
  it("renders authoritative gateway and approval metadata without mock events", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/gateway/activity") {
        return Response.json({ data: activityResponse });
      }
      if (url === "/api/approvals") {
        return Response.json({ data: approvalsResponse });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <HermesProvider>
        <ApprovalsClient />
      </HermesProvider>,
    );

    const request = await screen.findByRole("button", {
      name: /Live refund request for Order #LIVE-42/i,
    });
    expect(screen.queryByText(/Order #9812/i)).not.toBeInTheDocument();

    await user.click(request);

    expect(screen.getByText("request-digest-live-42")).toBeInTheDocument();
    expect(screen.getByText("key-thumbprint-live-42")).toBeInTheDocument();
    expect(screen.getByText("Policy v7")).toBeInTheDocument();
    expect(screen.getByText(/Ada Reviewer.*ada@example.com/i)).toBeInTheDocument();
    expect(screen.getByText("Awaiting reviewer decision")).toBeInTheDocument();
    expect(screen.getByText("Telegram sent")).toBeInTheDocument();
  });
});
