import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TelegramDeliveryTarget } from "@/lib/telegram/delivery";

const target: TelegramDeliveryTarget = {
  approvalId: "11111111-1111-4111-8111-111111111111",
  telegramChatId: 7_001_234_567,
  agentName: "Procurement agent",
  tool: "vendor.contract",
  summary: "Approve signed digest",
  amountCents: 25_000,
  currency: "HKD",
  requestDigest: "safe-digest",
  expiresAt: "2026-08-18T08:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
  getDeliveryTarget: vi.fn(),
  recordDelivery: vi.fn(),
  botToken: vi.fn(),
}));

vi.mock("@/lib/telegram/delivery-store", () => ({
  createPostgresTelegramDeliveryStore: () => ({
    getDeliveryTarget: mocks.getDeliveryTarget,
    recordDelivery: mocks.recordDelivery,
  }),
}));
vi.mock("@/lib/telegram/config", () => ({ telegramBotToken: mocks.botToken }));

beforeEach(() => {
  mocks.getDeliveryTarget.mockReset();
  mocks.recordDelivery
    .mockReset()
    .mockImplementation(async (_approvalId: string, state: "pending" | "sent" | "failed") => ({
      state,
      attempts: state === "pending" ? 0 : 1,
    }));
  mocks.botToken.mockReset().mockImplementation(() => {
    throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram operations");
  });
});

describe("optional Telegram delivery configuration", () => {
  it("keeps an unlinked approval web-only without requiring a bot token", async () => {
    mocks.getDeliveryTarget.mockResolvedValue(null);
    const { attemptTelegramDelivery } = await import("@/lib/telegram/delivery");

    await expect(attemptTelegramDelivery(target.approvalId)).resolves.toEqual({
      state: "not_requested",
      attempts: 0,
    });
    expect(mocks.botToken).not.toHaveBeenCalled();
  });

  it("persists a linked approval failure when bot configuration is unavailable", async () => {
    mocks.getDeliveryTarget.mockResolvedValue(target);
    const { attemptTelegramDelivery } = await import("@/lib/telegram/delivery");

    await expect(attemptTelegramDelivery(target.approvalId)).resolves.toEqual({
      state: "failed",
      attempts: 1,
    });
    expect(mocks.recordDelivery).toHaveBeenNthCalledWith(1, target.approvalId, "pending", null);
    expect(mocks.recordDelivery).toHaveBeenNthCalledWith(
      2,
      target.approvalId,
      "failed",
      "TELEGRAM_DELIVERY_FAILED",
    );
  });
});
