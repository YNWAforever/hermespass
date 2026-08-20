import { createTelegramClient, TelegramDeliveryError } from "@/lib/telegram/client";
import { telegramBotToken } from "@/lib/telegram/config";
import { createPostgresTelegramDeliveryStore } from "@/lib/telegram/delivery-store";

export type TelegramDeliveryTarget = {
  approvalId: string;
  telegramChatId: number;
  agentName: string;
  tool: string;
  summary: string;
  amountCents: number | null;
  currency: string | null;
  requestDigest: string;
  expiresAt: string;
};

export interface TelegramSender {
  sendApprovalMessage(target: TelegramDeliveryTarget): Promise<void>;
}

export function createConfiguredTelegramSender(): TelegramSender {
  return {
    async sendApprovalMessage(target) {
      return createTelegramClient({
        botToken: telegramBotToken(),
        fetchImpl: fetch,
      }).sendApprovalMessage(target);
    },
  };
}

export interface TelegramDeliveryStore {
  getDeliveryTarget(approvalId: string): Promise<TelegramDeliveryTarget | null>;
  recordDelivery(
    approvalId: string,
    state: "pending" | "sent" | "failed",
    errorCode: string | null,
  ): Promise<{ state: "pending" | "sent" | "failed"; attempts: number }>;
}

export async function attemptTelegramDelivery(
  approvalId: string,
  dependencies: {
    store: TelegramDeliveryStore;
    sender: TelegramSender;
  } = {
    store: createPostgresTelegramDeliveryStore(),
    sender: createConfiguredTelegramSender(),
  },
): Promise<{
  state: "not_requested" | "pending" | "sent" | "failed";
  attempts: number;
}> {
  const target = await dependencies.store.getDeliveryTarget(approvalId);
  if (!target) return { state: "not_requested", attempts: 0 };

  await dependencies.store.recordDelivery(approvalId, "pending", null);
  try {
    await dependencies.sender.sendApprovalMessage(target);
    return await dependencies.store.recordDelivery(approvalId, "sent", null);
  } catch (error) {
    const errorCode =
      error instanceof TelegramDeliveryError ? error.code : "TELEGRAM_DELIVERY_FAILED";
    return dependencies.store.recordDelivery(approvalId, "failed", errorCode);
  }
}
