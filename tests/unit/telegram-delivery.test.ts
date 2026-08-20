import { describe, expect, it, vi } from "vitest";

import {
  attemptTelegramDelivery,
  type TelegramDeliveryStore,
  type TelegramDeliveryTarget,
  type TelegramSender,
} from "@/lib/telegram/delivery";
import { createTelegramClient } from "@/lib/telegram/client";

const approvalId = "11111111-1111-4111-8111-111111111111";
const target: TelegramDeliveryTarget = {
  approvalId,
  telegramChatId: 7_001_234_567,
  agentName: "Procurement agent",
  tool: "vendor.contract",
  summary: "Approve the signed contract digest",
  amountCents: 25_000,
  currency: "HKD",
  requestDigest: "digest-safe",
  expiresAt: "2026-08-18T08:00:00.000Z",
};

class FakeDeliveryStore implements TelegramDeliveryStore {
  states: Array<{ approvalId: string; state: string; errorCode: string | null }> = [];
  deliveryTarget: TelegramDeliveryTarget | null = target;

  async getDeliveryTarget() {
    return this.deliveryTarget;
  }

  async recordDelivery(
    approvalIdValue: string,
    state: "pending" | "sent" | "failed",
    errorCode: string | null,
  ) {
    this.states.push({ approvalId: approvalIdValue, state, errorCode });
    return { state, attempts: state === "pending" ? 0 : 1 };
  }
}

describe("durable Telegram approval delivery", () => {
  it("persists pending before network and sent after a successful private DM", async () => {
    const store = new FakeDeliveryStore();
    const sender: TelegramSender = {
      sendApprovalMessage: vi.fn(async () => {
        expect(store.states).toEqual([{ approvalId, state: "pending", errorCode: null }]);
      }),
    };

    await expect(attemptTelegramDelivery(approvalId, { store, sender })).resolves.toEqual({
      state: "sent",
      attempts: 1,
    });
    expect(sender.sendApprovalMessage).toHaveBeenCalledWith(target);
    expect(store.states).toEqual([
      { approvalId, state: "pending", errorCode: null },
      { approvalId, state: "sent", errorCode: null },
    ]);
  });

  it("persists a safe retryable failure without throwing away the web hold", async () => {
    const store = new FakeDeliveryStore();
    const sender: TelegramSender = {
      sendApprovalMessage: vi.fn().mockRejectedValue(new Error("socket exposed-secret-value")),
    };

    await expect(attemptTelegramDelivery(approvalId, { store, sender })).resolves.toEqual({
      state: "failed",
      attempts: 1,
    });
    expect(store.states).toEqual([
      { approvalId, state: "pending", errorCode: null },
      { approvalId, state: "failed", errorCode: "TELEGRAM_DELIVERY_FAILED" },
    ]);
    expect(JSON.stringify(store.states)).not.toContain("exposed-secret-value");
  });

  it("keeps an unlinked reviewer as a durable web-only approval", async () => {
    const store = new FakeDeliveryStore();
    store.deliveryTarget = null;
    const sender: TelegramSender = { sendApprovalMessage: vi.fn() };

    await expect(attemptTelegramDelivery(approvalId, { store, sender })).resolves.toEqual({
      state: "not_requested",
      attempts: 0,
    });
    expect(sender.sendApprovalMessage).not.toHaveBeenCalled();
    expect(store.states).toEqual([]);
  });

  it("sends only bounded safe metadata and normalizes provider failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const client = createTelegramClient({ botToken: "bot-token-secret", fetchImpl });

    await client.sendApprovalMessage(target);

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe(target.telegramChatId);
    expect(body.text).toContain(target.requestDigest);
    expect(body.reply_markup.inline_keyboard).toEqual([
      [
        { text: "Approve", callback_data: `approval:${approvalId}:allow` },
        { text: "Deny", callback_data: `approval:${approvalId}:deny` },
      ],
    ]);
    expect(JSON.stringify(body)).not.toContain("bot-token-secret");
    expect(JSON.stringify(body)).not.toContain("justification");

    fetchImpl.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ description: "secret provider detail" }),
    });
    await expect(client.sendApprovalMessage(target)).rejects.toMatchObject({
      code: "TELEGRAM_HTTP_503",
    });

    fetchImpl.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, description: "secret provider detail" }),
    });
    await expect(client.sendApprovalMessage(target)).rejects.toMatchObject({
      code: "TELEGRAM_API_FAILED",
    });
  });
});
