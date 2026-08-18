import { sql } from "drizzle-orm";

import {
  ApprovalServiceError,
  type ApprovalDto,
  type ApprovalResolutionRecord,
  type ApprovalResolutionRequest,
  type ApprovalResolutionTransaction,
  type ApprovalServiceStore,
} from "@/lib/approvals/service";
import { PermissionDeniedError } from "@/lib/auth/errors";
import { withPublicDatabase, type Transaction } from "@/lib/db";

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

function dateIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

class PostgresApprovalTransaction implements ApprovalResolutionTransaction {
  constructor(private readonly transaction: Transaction) {}

  async resolve(
    input: Omit<ApprovalResolutionRequest, "actorUserId">,
  ): Promise<ApprovalResolutionRecord> {
    try {
      const result = await this.transaction.execute(sql`
        select approval_id, gateway_request_id, approval_status, current_decision
        from hermes_resolve_approval(
          ${input.approvalId}::uuid,
          ${input.decision}::gateway_decision,
          ${input.source}::approval_resolution_source,
          ${input.reason},
          ${input.telegramIdentity?.telegramUserId ?? null}::bigint,
          ${input.telegramIdentity?.telegramChatId ?? null}::bigint
        )
      `);
      const row = result.rows[0] as
        | {
            approval_id: string;
            gateway_request_id: string;
            approval_status: "approved" | "denied" | "expired";
            current_decision: "allow" | "deny";
          }
        | undefined;
      if (!row) throw new ApprovalServiceError("APPROVAL_UNAVAILABLE", 409);
      return {
        approvalId: row.approval_id,
        gatewayRequestId: row.gateway_request_id,
        status: row.approval_status,
        decision: row.current_decision,
      };
    } catch (error) {
      if (error instanceof ApprovalServiceError) throw error;
      if (errorCode(error) === "42501") throw new PermissionDeniedError();
      if (errorCode(error) === "P0001") {
        throw new ApprovalServiceError("APPROVAL_UNAVAILABLE", 409);
      }
      throw new ApprovalServiceError("APPROVALS_UNAVAILABLE", 503);
    }
  }
}

export type ApprovalTransactionRunner = <T>(
  callback: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const runPublicTransaction: ApprovalTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

export function createPostgresApprovalStore(
  runTransaction: ApprovalTransactionRunner = runPublicTransaction,
): ApprovalServiceStore {
  return {
    transaction: async <T>(
      actorUserId: string | null,
      callback: (transaction: ApprovalResolutionTransaction) => Promise<T>,
    ) =>
      runTransaction(async (transaction) => {
        await transaction.execute(
          sql`select set_config('hermes.user_id', ${actorUserId ?? ""}, true)`,
        );
        return callback(new PostgresApprovalTransaction(transaction));
      }),

    list: (actorUserId: string, organizationId: string) =>
      runTransaction(async (transaction) => {
        try {
          await transaction.execute(sql`select set_config('hermes.user_id', ${actorUserId}, true)`);
          const result = await transaction.execute(sql`
            select
              approval.id,
              approval.gateway_request_id,
              approval.agent_id,
              agent.name as agent_name,
              agent.did as agent_did,
              request.tool,
              request.summary,
              request.amount_cents,
              request.currency,
              request.merchant_category_code,
              request.request_digest,
              key.thumbprint as key_thumbprint,
              request.policy_version,
              approval.assigned_reviewer_user_id,
              reviewer.name_snapshot as assigned_reviewer_name,
              reviewer.email_snapshot as assigned_reviewer_email,
              approval.status,
              approval.resolution,
              approval.resolution_source,
              approval.resolution_reason,
              approval.resolved_at,
              approval.expires_at,
              request.authorization_expires_at,
              approval.telegram_delivery_state,
              approval.telegram_delivery_attempts,
              approval.telegram_last_attempt_at,
              approval.telegram_delivered_at,
              approval.telegram_last_error_code,
              approval.created_at
            from pending_approvals approval
            join gateway_requests request
              on request.id = approval.gateway_request_id
             and request.agent_id = approval.agent_id
             and request.organization_id = approval.organization_id
            join agents agent
              on agent.id = approval.agent_id
             and agent.organization_id = approval.organization_id
            join agent_keys key
              on key.id = request.key_id
             and key.agent_id = request.agent_id
             and key.organization_id = request.organization_id
            left join org_members reviewer
              on reviewer.organization_id = approval.organization_id
             and reviewer.user_id = approval.assigned_reviewer_user_id
            where approval.organization_id = ${organizationId}::uuid
            order by (approval.status = 'pending') desc, approval.created_at desc
          `);

          return result.rows.map((value) => {
            const row = value as Record<string, unknown>;
            const digest = row["request_digest"] as Buffer | Uint8Array;
            return {
              id: String(row["id"]),
              gatewayRequestId: String(row["gateway_request_id"]),
              agentId: String(row["agent_id"]),
              agentName: String(row["agent_name"]),
              agentDid: String(row["agent_did"]),
              tool: String(row["tool"]),
              summary: String(row["summary"]),
              amountCents: row["amount_cents"] === null ? null : Number(row["amount_cents"]),
              currency: row["currency"] === null ? null : String(row["currency"]),
              merchantCategoryCode:
                row["merchant_category_code"] === null
                  ? null
                  : String(row["merchant_category_code"]),
              requestDigest: Buffer.from(digest).toString("base64url"),
              keyThumbprint: String(row["key_thumbprint"]),
              policyVersion: row["policy_version"] === null ? null : Number(row["policy_version"]),
              assignedReviewerUserId: String(row["assigned_reviewer_user_id"]),
              assignedReviewerName:
                row["assigned_reviewer_name"] === null
                  ? null
                  : String(row["assigned_reviewer_name"]),
              assignedReviewerEmail:
                row["assigned_reviewer_email"] === null
                  ? null
                  : String(row["assigned_reviewer_email"]),
              status: row["status"],
              resolution: row["resolution"],
              resolutionSource: row["resolution_source"],
              resolutionReason:
                row["resolution_reason"] === null ? null : String(row["resolution_reason"]),
              resolvedAt: dateIso(row["resolved_at"] as Date | string | null),
              expiresAt: dateIso(row["expires_at"] as Date | string)!,
              authorizationExpiresAt: dateIso(
                row["authorization_expires_at"] as Date | string | null,
              ),
              telegramDeliveryState: row["telegram_delivery_state"],
              telegramDeliveryAttempts: Number(row["telegram_delivery_attempts"]),
              telegramLastAttemptAt: dateIso(
                row["telegram_last_attempt_at"] as Date | string | null,
              ),
              telegramDeliveredAt: dateIso(row["telegram_delivered_at"] as Date | string | null),
              telegramLastErrorCode:
                row["telegram_last_error_code"] === null
                  ? null
                  : String(row["telegram_last_error_code"]),
              createdAt: dateIso(row["created_at"] as Date | string)!,
            } as ApprovalDto;
          });
        } catch (error) {
          if (error instanceof ApprovalServiceError) throw error;
          throw new ApprovalServiceError("APPROVALS_UNAVAILABLE", 503);
        }
      }),
  };
}
