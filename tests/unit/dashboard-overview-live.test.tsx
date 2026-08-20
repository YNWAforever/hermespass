import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardOverviewClient } from "@/components/hermes/dashboard/dashboard-overview-client";
import { Providers } from "@/app/providers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live gateway overview", () => {
  it("populates gateway KPIs and recent activity from request aggregates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: {
          activity: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              agentId: "20000000-0000-4000-8000-000000000001",
              agentSlug: "fimmick-merchant-concierge",
              agentName: "Fimmick Merchant Concierge",
              agentDid: "did:web:hermespass.asia:agent:fimmick-merchant-concierge",
              timestamp: "2026-08-18T04:03:02.000Z",
              tool: "refund.issue",
              summary: "Authoritative overview activity",
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
            deniedCount: 3,
            decisionCounts: { allow: 38, hold: 1, deny: 3 },
            trend: [{ hour: "04:00", allow: 38, hold: 1, deny: 3 }],
          },
        },
      }),
    );

    render(
      <Providers>
        <DashboardOverviewClient />
      </Providers>,
    );

    expect(await screen.findByText("Authoritative overview activity")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("HK$ 26,400")).toBeInTheDocument();
    expect(screen.getByText("3 denied payment mandates")).toBeInTheDocument();
  });
});
