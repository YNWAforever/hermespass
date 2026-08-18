import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  userId: "owner-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Test org",
  organizationSlug: "test-org",
  email: "owner@example.com",
  name: "Owner",
  role: "owner" as const,
};
const mocks = vi.hoisted(() => ({ requireActor: vi.fn(), createLinkToken: vi.fn() }));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/telegram/service", () => ({ createTelegramLinkToken: mocks.createLinkToken }));

beforeEach(() => {
  mocks.requireActor.mockReset().mockResolvedValue(actor);
  mocks.createLinkToken.mockReset().mockResolvedValue({
    deepLinkUrl: `https://t.me/HermesPassTestBot?start=${"A".repeat(43)}`,
    expiresAt: "2026-08-18T05:10:00.000Z",
  });
});

describe("protected Telegram link-token API", () => {
  it("returns only the one-time deep link in the standard data envelope", async () => {
    const { POST } = await import("@/app/api/telegram/link-tokens/route");
    const request = new Request("http://localhost/api/telegram/link-tokens", {
      method: "POST",
      body: JSON.stringify({ userId: "reviewer-1" }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: {
        link: {
          deepLinkUrl: `https://t.me/HermesPassTestBot?start=${"A".repeat(43)}`,
          expiresAt: "2026-08-18T05:10:00.000Z",
        },
      },
    });
    expect(mocks.createLinkToken).toHaveBeenCalledWith(actor, "reviewer-1");
  });

  it("rejects client-supplied organization or Telegram identity", async () => {
    const { POST } = await import("@/app/api/telegram/link-tokens/route");
    const request = new Request("http://localhost/api/telegram/link-tokens", {
      method: "POST",
      body: JSON.stringify({
        userId: "reviewer-1",
        organizationId: "attacker-org",
        telegramUserId: 42,
      }),
      headers: { "content-type": "application/json", "x-request-id": "req-link" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: "req-link" },
    });
    expect(mocks.createLinkToken).not.toHaveBeenCalled();
  });
});
