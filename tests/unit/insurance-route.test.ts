import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  listPolicies: vi.fn(),
  quote: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/insurance/service", () => ({
  listPolicies: mocks.listPolicies,
  quote: mocks.quote,
}));

import { GET } from "@/app/api/insurance/policies/route";
import { POST } from "@/app/api/insurance/quote/route";

const actor = {
  userId: "owner-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Org",
  organizationSlug: "org",
  role: "owner" as const,
  email: null,
  name: null,
};

describe("insurance routes", () => {
  beforeEach(() => {
    mocks.requireActor.mockReset();
    mocks.listPolicies.mockReset();
    mocks.quote.mockReset();
    mocks.requireActor.mockResolvedValue(actor);
    mocks.listPolicies.mockResolvedValue([]);
    mocks.quote.mockResolvedValue({ id: "p-1", status: "quoted" });
  });

  it("returns the authenticated policy list envelope", async () => {
    const response = await GET(new Request("http://localhost/api/insurance/policies?limit=20"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { policies: [] } });
    expect(mocks.listPolicies).toHaveBeenCalledWith(actor, null, 20);
  });

  it("quotes without accepting organization identity from the browser", async () => {
    const response = await POST(
      new Request("http://localhost/api/insurance/quote", {
        method: "POST",
        body: JSON.stringify({
          agentId: "22222222-2222-4222-8222-222222222222",
          organizationId: "attacker-org",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.quote).toHaveBeenCalledWith(actor, "22222222-2222-4222-8222-222222222222");
  });

  it("rejects malformed and oversized quote bodies", async () => {
    const invalid = await POST(
      new Request("http://localhost/api/insurance/quote", { method: "POST", body: "not-json" }),
    );
    expect(invalid.status).toBe(400);
    const oversized = await POST(
      new Request("http://localhost/api/insurance/quote", {
        method: "POST",
        body: JSON.stringify({ agentId: "x", padding: "x".repeat(17 * 1024) }),
      }),
    );
    expect(oversized.status).toBe(413);
  });
});
