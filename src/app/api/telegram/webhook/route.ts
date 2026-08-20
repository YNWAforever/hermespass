import { timingSafeEqual } from "node:crypto";

import { errorResponse, jsonError, ok } from "@/lib/http";
import { telegramWebhookSecret } from "@/lib/telegram/config";
import { TelegramServiceError } from "@/lib/telegram/service";
import { handleTelegramUpdate } from "@/lib/telegram/update";

export const dynamic = "force-dynamic";

function exactSecret(candidate: string | null, expected: string): boolean {
  if (!candidate) return false;
  const actualBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function POST(request: Request) {
  try {
    if (
      !exactSecret(request.headers.get("x-telegram-bot-api-secret-token"), telegramWebhookSecret())
    ) {
      return jsonError(
        request,
        "TELEGRAM_WEBHOOK_UNAUTHORIZED",
        "Telegram webhook authentication failed.",
        401,
      );
    }
    const result = await handleTelegramUpdate(await request.json());
    return ok({ accepted: true, result });
  } catch (error) {
    if (error instanceof TelegramServiceError) {
      return jsonError(
        request,
        error.code,
        error.code === "TELEGRAM_IDENTITY_UNLINKED"
          ? "The Telegram reviewer identity is not linked for this approval."
          : "The Telegram update is invalid or unavailable.",
        error.status,
      );
    }
    return errorResponse(request, error);
  }
}
