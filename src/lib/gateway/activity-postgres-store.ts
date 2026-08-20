import { sql } from "drizzle-orm";

import type { GatewayActivityStore } from "@/lib/gateway/activity-service";
import type {
  GatewayActivityItem,
  GatewayActivityResponse,
  GatewayDecisionTrendPoint,
} from "@/lib/gateway/activity-types";
import { withPublicDatabase, type Transaction } from "@/lib/db";

export type GatewayActivityTransactionRunner = <T>(
  callback: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const runPublicTransaction: GatewayActivityTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function dateIso(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : new Date(value as Date | string).toISOString();
}

function count(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function mapActivity(value: unknown): GatewayActivityItem {
  const row = value as Record<string, unknown>;
  const digest = row["request_digest"] as Buffer | Uint8Array;
  return {
    id: String(row["id"]),
    agentId: String(row["agent_id"]),
    agentSlug: String(row["agent_slug"]),
    agentName: String(row["agent_name"]),
    agentDid: String(row["agent_did"]),
    timestamp: dateIso(row["decided_at"])!,
    tool: String(row["tool"]),
    summary: String(row["summary"]),
    amountCents: row["amount_cents"] === null ? null : Number(row["amount_cents"]),
    currency: nullableString(row["currency"]),
    decision: row["current_decision"] as GatewayActivityItem["decision"],
    reason: String(row["reason"]),
    requestDigest: Buffer.from(digest).toString("base64url"),
    keyThumbprint: String(row["key_thumbprint"]),
    policyVersion: row["policy_version"] === null ? null : Number(row["policy_version"]),
    approvalId: nullableString(row["approval_id"]),
    approvalStatus: (row["approval_status"] ?? null) as GatewayActivityItem["approvalStatus"],
    assignedReviewerUserId: nullableString(row["assigned_reviewer_user_id"]),
    assignedReviewerName: nullableString(row["assigned_reviewer_name"]),
    assignedReviewerEmail: nullableString(row["assigned_reviewer_email"]),
    authorizationExpiresAt: dateIso(row["authorization_expires_at"]),
    telegramDeliveryState: (row["telegram_delivery_state"] ??
      null) as GatewayActivityItem["telegramDeliveryState"],
  };
}

function mapTrend(value: unknown): GatewayDecisionTrendPoint {
  const row = value as Record<string, unknown>;
  return {
    hour: String(row["hour"]),
    allow: count(row["allow_count"]),
    hold: count(row["hold_count"]),
    deny: count(row["deny_count"]),
  };
}

export function createPostgresGatewayActivityStore(
  runTransaction: GatewayActivityTransactionRunner = runPublicTransaction,
): GatewayActivityStore {
  return {
    list: (actorUserId: string, organizationId: string) =>
      runTransaction(async (transaction): Promise<GatewayActivityResponse> => {
        try {
          await transaction.execute(sql`select set_config('hermes.user_id', ${actorUserId}, true)`);
          const activityResult = await transaction.execute(sql`
            select
              request.id,
              request.agent_id,
              agent.slug as agent_slug,
              agent.name as agent_name,
              agent.did as agent_did,
              request.decided_at,
              request.tool,
              request.summary,
              request.amount_cents,
              request.currency,
              request.current_decision,
              request.reason,
              request.request_digest,
              key.thumbprint as key_thumbprint,
              request.policy_version,
              approval.id as approval_id,
              approval.status as approval_status,
              approval.assigned_reviewer_user_id,
              reviewer.name_snapshot as assigned_reviewer_name,
              reviewer.email_snapshot as assigned_reviewer_email,
              request.authorization_expires_at,
              approval.telegram_delivery_state
            from gateway_requests request
            join agents agent
              on agent.id = request.agent_id
             and agent.organization_id = request.organization_id
            join agent_keys key
              on key.id = request.key_id
             and key.agent_id = request.agent_id
             and key.organization_id = request.organization_id
            left join pending_approvals approval
              on approval.gateway_request_id = request.id
             and approval.agent_id = request.agent_id
             and approval.organization_id = request.organization_id
            left join org_members reviewer
              on reviewer.organization_id = approval.organization_id
             and reviewer.user_id = approval.assigned_reviewer_user_id
            where request.organization_id = ${organizationId}::uuid
            order by request.decided_at desc
            limit 100
          `);
          const aggregateResult = await transaction.execute(sql`
            select
              count(*) filter (
                where request.decided_at >=
                  (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
              ) as actions_today,
              (
                select count(*)
                from pending_approvals approval
                where approval.organization_id = ${organizationId}::uuid
                  and approval.status = 'pending'
              ) as pending_holds,
              coalesce(sum(request.amount_cents) filter (
                where request.decided_at >= now() - interval '18 hours'
                  and request.current_decision = 'deny'
                  and request.currency = 'HKD'
              ), 0) as blocked_spend_cents,
              count(*) filter (
                where request.decided_at >= now() - interval '18 hours'
                  and request.current_decision = 'deny'
              ) as denied_count,
              count(*) filter (
                where request.decided_at >= now() - interval '18 hours'
                  and request.current_decision = 'allow'
              ) as allow_count,
              count(*) filter (
                where request.decided_at >= now() - interval '18 hours'
                  and request.current_decision = 'hold'
              ) as hold_count,
              count(*) filter (
                where request.decided_at >= now() - interval '18 hours'
                  and request.current_decision = 'deny'
              ) as deny_count
            from gateway_requests request
            where request.organization_id = ${organizationId}::uuid
              and request.decided_at >= least(
                (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
                now() - interval '18 hours'
              )
          `);
          const trendResult = await transaction.execute(sql`
            with hours as (
              select generate_series(
                date_trunc('hour', now()) - interval '17 hours',
                date_trunc('hour', now()),
                interval '1 hour'
              ) as bucket
            )
            select
              to_char(hours.bucket at time zone 'UTC', 'HH24:00') as hour,
              count(request.id) filter (where request.current_decision = 'allow') as allow_count,
              count(request.id) filter (where request.current_decision = 'hold') as hold_count,
              count(request.id) filter (where request.current_decision = 'deny') as deny_count
            from hours
            left join gateway_requests request
              on request.organization_id = ${organizationId}::uuid
             and request.decided_at >= hours.bucket
             and request.decided_at < hours.bucket + interval '1 hour'
            group by hours.bucket
            order by hours.bucket
          `);

          const aggregate = (aggregateResult.rows[0] ?? {}) as Record<string, unknown>;
          return {
            activity: activityResult.rows.map(mapActivity),
            aggregates: {
              actionsToday: count(aggregate["actions_today"]),
              pendingHolds: count(aggregate["pending_holds"]),
              blockedSpendCents: count(aggregate["blocked_spend_cents"]),
              deniedCount: count(aggregate["denied_count"]),
              decisionCounts: {
                allow: count(aggregate["allow_count"]),
                hold: count(aggregate["hold_count"]),
                deny: count(aggregate["deny_count"]),
              },
              trend: trendResult.rows.map(mapTrend),
            },
          };
        } catch {
          throw new Error("GATEWAY_UNAVAILABLE");
        }
      }),
  };
}
