import { sql } from "drizzle-orm";

import { withPublicDatabase, type Transaction } from "@/lib/db";
import type { TelegramDeliveryStore, TelegramDeliveryTarget } from "@/lib/telegram/delivery";

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export type TelegramDeliveryTransactionRunner = <T>(
  callback: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const runPublicTransaction: TelegramDeliveryTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

export function createPostgresTelegramDeliveryStore(
  runTransaction: TelegramDeliveryTransactionRunner = runPublicTransaction,
): TelegramDeliveryStore {
  return {
    getDeliveryTarget: (approvalId: string) =>
      runTransaction(async (transaction) => {
        await transaction.execute(sql`select set_config('hermes.user_id', '', true)`);
        const result = await transaction.execute(sql`
          select * from hermes_approval_delivery_target(${approvalId}::uuid)
        `);
        const row = result.rows[0] as
          | {
              approval_id: string;
              telegram_chat_id: number | string;
              agent_name: string;
              tool: string;
              summary: string;
              amount_cents: number | string | null;
              currency: string | null;
              request_digest: Buffer | Uint8Array;
              expires_at: Date | string;
            }
          | undefined;
        if (!row) return null;
        return {
          approvalId: row.approval_id,
          telegramChatId: Number(row.telegram_chat_id),
          agentName: row.agent_name,
          tool: row.tool,
          summary: row.summary,
          amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
          currency: row.currency,
          requestDigest: Buffer.from(row.request_digest).toString("base64url"),
          expiresAt: iso(row.expires_at),
        } satisfies TelegramDeliveryTarget;
      }),

    recordDelivery: (approvalId, state, errorCode) =>
      runTransaction(async (transaction) => {
        await transaction.execute(sql`select set_config('hermes.user_id', '', true)`);
        const result = await transaction.execute(sql`
          select delivery_state, delivery_attempts
          from hermes_record_approval_delivery(
            ${approvalId}::uuid,
            ${state}::telegram_delivery_state,
            ${errorCode}
          )
        `);
        const row = result.rows[0] as
          { delivery_state: "pending" | "sent" | "failed"; delivery_attempts: number } | undefined;
        if (!row) throw new Error("TELEGRAM_DELIVERY_STATE_UNAVAILABLE");
        return { state: row.delivery_state, attempts: Number(row.delivery_attempts) };
      }),
  };
}
