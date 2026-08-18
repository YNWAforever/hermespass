import { sql } from "drizzle-orm";

import { withPublicDatabase } from "@/lib/db";
import { TelegramServiceError, type TelegramLinkDto } from "@/lib/telegram/service";
import type { TelegramReviewStore } from "@/lib/telegram/update";

type DatabaseError = { code?: unknown; cause?: unknown };

function errorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return "";
    const candidate = current as DatabaseError;
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return "";
}

export function createPostgresTelegramStore(): TelegramReviewStore {
  return {
    createLinkToken: (input) =>
      withPublicDatabase((database) =>
        database.transaction(async (transaction) => {
          try {
            await transaction.execute(
              sql`select set_config('hermes.user_id', ${input.actorUserId}, true)`,
            );
            const result = await transaction.execute(sql`
              select expires_at
              from hermes_create_telegram_link_token(
                ${input.organizationId}::uuid,
                ${input.targetUserId},
                ${input.tokenHash}::bytea
              )
            `);
            const row = result.rows[0] as { expires_at: Date | string } | undefined;
            if (!row) throw new TelegramServiceError("TELEGRAM_LINK_UNAVAILABLE", 503);
            return { expiresAt: new Date(row.expires_at) };
          } catch (error) {
            if (error instanceof TelegramServiceError) throw error;
            if (errorCode(error) === "42501") {
              throw new TelegramServiceError("TELEGRAM_LINK_INVALID", 400);
            }
            throw new TelegramServiceError("TELEGRAM_LINK_UNAVAILABLE", 503);
          }
        }),
      ),

    consumeLinkToken: (input): Promise<TelegramLinkDto> =>
      withPublicDatabase((database) =>
        database.transaction(async (transaction) => {
          try {
            await transaction.execute(sql`select set_config('hermes.user_id', '', true)`);
            const result = await transaction.execute(sql`
              select organization_id, user_id, link_id
              from hermes_consume_telegram_link_token(
                ${input.tokenHash}::bytea,
                ${input.telegramUserId}::bigint,
                ${input.telegramChatId}::bigint
              )
            `);
            const row = result.rows[0] as
              { organization_id: string; user_id: string; link_id: string } | undefined;
            if (!row) throw new TelegramServiceError("TELEGRAM_LINK_INVALID", 400);
            return {
              organizationId: row.organization_id,
              userId: row.user_id,
              linkId: row.link_id,
            };
          } catch (error) {
            if (error instanceof TelegramServiceError) throw error;
            if (errorCode(error) === "P0002") {
              throw new TelegramServiceError("TELEGRAM_LINK_INVALID", 400);
            }
            throw new TelegramServiceError("TELEGRAM_LINK_UNAVAILABLE", 503);
          }
        }),
      ),

    findReviewerIdentity: (input) =>
      withPublicDatabase((database) =>
        database.transaction(async (transaction) => {
          try {
            await transaction.execute(sql`select set_config('hermes.user_id', '', true)`);
            const result = await transaction.execute(sql`
              select user_id
              from hermes_telegram_reviewer_identity(
                ${input.approvalId}::uuid,
                ${input.telegramUserId}::bigint,
                ${input.telegramChatId}::bigint
              )
            `);
            const row = result.rows[0] as { user_id: string } | undefined;
            return row ? { userId: row.user_id } : null;
          } catch (error) {
            if (error instanceof TelegramServiceError) throw error;
            throw new TelegramServiceError("TELEGRAM_LINK_UNAVAILABLE", 503);
          }
        }),
      ),
  };
}
