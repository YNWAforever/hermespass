import { sql } from "drizzle-orm";

import { ApprovalServiceError } from "@/lib/approvals/service";
import { withPublicDatabase, type Transaction } from "@/lib/db";
import type {
  ApprovalMaintenanceBatch,
  ApprovalMaintenanceStore,
} from "@/lib/approvals/maintenance";
import type { TelegramDeliveryTarget } from "@/lib/telegram/delivery";

function target(row: Record<string, unknown>): TelegramDeliveryTarget {
  return {
    approvalId: String(row["approval_id"]),
    telegramChatId: Number(row["telegram_chat_id"]),
    agentName: String(row["agent_name"]),
    tool: String(row["tool"]),
    summary: String(row["summary"]),
    amountCents: row["amount_cents"] === null ? null : Number(row["amount_cents"]),
    currency: row["currency"] === null ? null : String(row["currency"]),
    requestDigest: Buffer.from(row["request_digest"] as Buffer | Uint8Array).toString("base64url"),
    expiresAt: new Date(row["expires_at"] as Date | string).toISOString(),
  };
}

export type ApprovalMaintenanceTransactionRunner = <T>(
  callback: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const runPublicTransaction: ApprovalMaintenanceTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

export function createPostgresApprovalMaintenanceStore(
  runTransaction: ApprovalMaintenanceTransactionRunner = runPublicTransaction,
): ApprovalMaintenanceStore {
  return {
    claim: (): Promise<ApprovalMaintenanceBatch> =>
      runTransaction(async (transaction) => {
        try {
          await transaction.execute(sql`select set_config('hermes.user_id', '', true)`);
          const lock = await transaction.execute(sql`
            select hermes_try_lock_approval_maintenance() as acquired
          `);
          if (!(lock.rows[0] as { acquired?: boolean } | undefined)?.acquired) {
            return {
              acquired: false,
              expiredApprovalIds: [],
              deliveryTargets: [],
            };
          }

          const expired = await transaction.execute(
            sql`select approval_id from hermes_expired_approval_ids()`,
          );
          const deliveries = await transaction.execute(
            sql`select * from hermes_claim_approval_delivery_targets()`,
          );
          return {
            acquired: true,
            expiredApprovalIds: expired.rows.map((row) =>
              String((row as Record<string, unknown>)["approval_id"]),
            ),
            deliveryTargets: deliveries.rows.map((row) => target(row as Record<string, unknown>)),
          };
        } catch (error) {
          if (error instanceof ApprovalServiceError) throw error;
          throw new ApprovalServiceError("APPROVALS_UNAVAILABLE", 503);
        }
      }),
  };
}
