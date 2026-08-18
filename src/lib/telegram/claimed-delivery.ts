import { TelegramDeliveryError } from "@/lib/telegram/client";
import type {
  TelegramDeliveryStore,
  TelegramDeliveryTarget,
  TelegramSender,
} from "@/lib/telegram/delivery";

export async function finishClaimedTelegramDelivery(
  target: TelegramDeliveryTarget,
  dependencies: { store: TelegramDeliveryStore; sender: TelegramSender },
): Promise<{ state: "sent" | "failed"; attempts: number }> {
  let failureCode: string | null = null;
  try {
    await dependencies.sender.sendApprovalMessage(target);
  } catch (error) {
    failureCode = error instanceof TelegramDeliveryError ? error.code : "TELEGRAM_DELIVERY_FAILED";
  }

  const finalState = failureCode === null ? "sent" : "failed";
  const recorded = await dependencies.store.recordDelivery(
    target.approvalId,
    finalState,
    failureCode,
  );
  if (recorded.state !== finalState) {
    throw new Error("TELEGRAM_DELIVERY_FINAL_STATE_INVALID");
  }
  return {
    state: finalState,
    attempts: recorded.attempts,
  };
}
