import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  userId: "reviewer-1",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Review org",
  organizationSlug: "review-org",
  email: "reviewer@example.com",
  name: "Reviewer",
  role: "admin" as const,
};

const activity = {
  activity: [],
  aggregates: {
    actionsToday: 42,
    pendingHolds: 1,
    blockedSpendCents: 2_640_000,
    deniedCount: 3,
    decisionCounts: { allow: 38, hold: 1, deny: 3 },
    trend: [{ hour: "04:00", allow: 38, hold: 1, deny: 3 }],
  },
};

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  listGatewayActivity: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/gateway/activity-service", () => ({
  listGatewayActivity: mocks.listGatewayActivity,
}));

beforeEach(() => {
  mocks.requireActor.mockReset();
  mocks.listGatewayActivity.mockReset();
  mocks.requireActor.mockResolvedValue(actor);
  mocks.listGatewayActivity.mockResolvedValue(activity);
});

describe("gateway activity API", () => {
  it("returns the authenticated organization read model without raw payloads", async () => {
    const { GET } = await import("@/app/api/gateway/activity/route");
    const request = new Request("http://localhost/api/gateway/activity");

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: activity });
    expect(mocks.listGatewayActivity).toHaveBeenCalledWith(actor);
    expect(JSON.stringify(body)).not.toContain("payload");
    expect(JSON.stringify(body)).not.toContain("signature");
  });
});
