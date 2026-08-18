import type { TelegramDeliveryTarget, TelegramSender } from "@/lib/telegram/delivery";

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<FetchResponse>;

export class TelegramDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TelegramDeliveryError";
  }
}

function amount(target: TelegramDeliveryTarget): string {
  if (target.amountCents === null || target.currency === null) return "Not a spend action";
  return `${target.currency} ${(target.amountCents / 100).toFixed(2)}`;
}

export function createTelegramClient(input: {
  botToken: string;
  fetchImpl: FetchLike;
}): TelegramSender {
  return {
    async sendApprovalMessage(target) {
      let response: FetchResponse;
      try {
        response = await input.fetchImpl(
          `https://api.telegram.org/bot${input.botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: target.telegramChatId,
              text: [
                "HermesPass approval review",
                `Agent: ${target.agentName}`,
                `Tool: ${target.tool}`,
                `Summary: ${target.summary}`,
                `Amount: ${amount(target)}`,
                `Request digest: ${target.requestDigest}`,
                `Expires: ${target.expiresAt}`,
              ].join("\n"),
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "Approve",
                      callback_data: `approval:${target.approvalId}:allow`,
                    },
                    {
                      text: "Deny",
                      callback_data: `approval:${target.approvalId}:deny`,
                    },
                  ],
                ],
              },
            }),
          },
        );
      } catch {
        throw new TelegramDeliveryError("TELEGRAM_DELIVERY_FAILED");
      }
      if (!response.ok) {
        const status = Number(response.status);
        throw new TelegramDeliveryError(
          Number.isInteger(status) && status >= 400 && status <= 599
            ? `TELEGRAM_HTTP_${status}`
            : "TELEGRAM_API_FAILED",
        );
      }

      let payload: unknown;
      try {
        payload = await response.json?.();
      } catch {
        throw new TelegramDeliveryError("TELEGRAM_API_FAILED");
      }
      if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
        throw new TelegramDeliveryError("TELEGRAM_API_FAILED");
      }
    },
  };
}
