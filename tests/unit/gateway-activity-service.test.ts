import { describe, expect, it, vi } from "vitest";

import { listGatewayActivity } from "@/lib/gateway/activity-service";

const actor = {
  userId: "reviewer-1",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Review org",
  organizationSlug: "review-org",
  email: "reviewer@example.com",
  name: "Reviewer",
  role: "admin" as const,
};

describe("gateway activity service", () => {
  it("scopes the dashboard read model to the authenticated user and organization", async () => {
    const response = {
      activity: [],
      aggregates: {
        actionsToday: 0,
        pendingHolds: 0,
        blockedSpendCents: 0,
        deniedCount: 0,
        decisionCounts: { allow: 0, hold: 0, deny: 0 },
        trend: [],
      },
    };
    const store = { list: vi.fn().mockResolvedValue(response) };

    await expect(listGatewayActivity(actor, store)).resolves.toEqual(response);
    expect(store.list).toHaveBeenCalledWith(actor.userId, actor.organizationId);
  });
});
