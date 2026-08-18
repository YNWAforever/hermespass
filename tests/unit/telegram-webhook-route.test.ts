import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webhookSecret: vi.fn(),
  handleUpdate: vi.fn(),
}));

vi.mock("@/lib/telegram/config", () => ({ telegramWebhookSecret: mocks.webhookSecret }));
vi.mock("@/lib/telegram/update", () => ({ handleTelegramUpdate: mocks.handleUpdate }));

beforeEach(() => {
  mocks.webhookSecret.mockReset().mockReturnValue("webhook-secret-value");
  mocks.handleUpdate.mockReset().mockResolvedValue({ kind: "ignored" });
});

describe("Telegram webhook route", () => {
  it("rejects a missing or wrong Telegram secret header before parsing", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const request = new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      body: "{not-json",
      headers: { "x-request-id": "req-telegram-secret" },
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "TELEGRAM_WEBHOOK_UNAUTHORIZED",
        message: "Telegram webhook authentication failed.",
        requestId: "req-telegram-secret",
      },
    });
    expect(mocks.handleUpdate).not.toHaveBeenCalled();
  });

  it("accepts only the exact secret and preserves the data envelope", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const update = { update_id: 123, message: { text: "ignored" } };
    const request = new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify(update),
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "webhook-secret-value",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { accepted: true, result: { kind: "ignored" } },
    });
    expect(mocks.handleUpdate).toHaveBeenCalledWith(update);
  });
});
