import { sql } from "drizzle-orm";

import { withPublicDatabase, type Transaction } from "@/lib/db";
import {
  type PaymentAuthorizationInsert,
  type PaymentAuthorizationStore,
  type PaymentAuthorizationTransactionPort,
  type PaymentCardContext,
  type PaymentDecision,
  type PaymentMandateContext,
  type StoredPaymentDecision,
} from "@/lib/payments/authorization-service";
import type { PaymentAuthorizationInput } from "@/lib/payments/rails/types";
import type { GatewayPolicy } from "@/lib/policy/engine";

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function readCard(row: Record<string, unknown> | undefined): PaymentCardContext | null {
  if (!row) return null;
  const keyId = row["key_id"];
  return {
    walletCardId: String(row["wallet_card_id"]),
    organizationId: String(row["organization_id"]),
    agentId: String(row["agent_id"]),
    rail: String(row["rail"]),
    railCardId: String(row["rail_card_id"]),
    currency: String(row["card_currency"]),
    cardStatus: row["card_status"] as PaymentCardContext["cardStatus"],
    agentDid: String(row["agent_did"]),
    agentStatus: row["agent_status"] as PaymentCardContext["agentStatus"],
    passportExpiresAt: asDate(row["passport_expires_at"] as Date | string),
    scopes: Array.isArray(row["scopes"]) ? (row["scopes"] as string[]) : [],
    spendCapCents: Number(row["spend_cap_cents"]),
    risk: row["risk"] as PaymentCardContext["risk"],
    keyId: keyId ? String(keyId) : "00000000-0000-4000-8000-000000000000",
    keyActive: Boolean(row["key_active"]),
  };
}

function readPolicy(row: Record<string, unknown> | undefined): GatewayPolicy | null {
  if (!row) return null;
  return {
    version: Number(row["version"]),
    currency: "HKD",
    perTransactionLimitCents: Number(row["per_transaction_limit_cents"]),
    dailyLimitCents: Number(row["daily_limit_cents"]),
    monthlyLimitCents: Number(row["monthly_limit_cents"]),
    approvalThresholdCents: Number(row["approval_threshold_cents"]),
    mccAllowlist: Array.isArray(row["mcc_allowlist"]) ? (row["mcc_allowlist"] as string[]) : [],
    mccRequired: Boolean(row["mcc_required"]),
    assignedReviewerUserId: String(row["assigned_reviewer_user_id"]),
  };
}

function readMandate(row: Record<string, unknown> | undefined): PaymentMandateContext | null {
  if (!row) return null;
  return {
    id: String(row["id"]),
    agentId: String(row["agent_id"]),
    organizationId: String(row["organization_id"]),
    status: row["status"] as PaymentMandateContext["status"],
    currency: "HKD",
    maxAmountCents: Number(row["max_amount_cents"]),
    merchant: row["merchant"] == null ? null : String(row["merchant"]),
    mccAllowlist: Array.isArray(row["mcc_allowlist"]) ? (row["mcc_allowlist"] as string[]) : [],
    expiresAt: asDate(row["expires_at"] as Date | string).toISOString(),
    oneTime: Boolean(row["one_time"]),
  };
}

function readReplay(row: Record<string, unknown> | undefined): StoredPaymentDecision | null {
  if (!row) return null;
  return {
    authorizationId: String(row["id"]),
    approved: Boolean(row["approved"]),
    reasonCode: String(row["reason_code"]),
    reason: String(row["reason"]),
    mandateId: row["mandate_id"] == null ? null : String(row["mandate_id"]),
    policyVersion: row["policy_version"] == null ? null : Number(row["policy_version"]),
    decidedAt: asDate(row["decided_at"] as Date | string).toISOString(),
    latencyMs: Number(row["latency_ms"]),
    fingerprint: (() => {
      const value = (row["fingerprint"] ?? {}) as Record<string, unknown>;
      return JSON.stringify({
        rail: String(value["rail"] ?? "mock"),
        eventId: String(value["eventId"] ?? ""),
        railAuthorizationId: String(value["railAuthorizationId"] ?? ""),
        railCardId: value["railCardId"] ?? null,
        mandateId: value["mandateId"] ?? null,
        amountCents: Number(value["amountCents"] ?? 0),
        currency: String(value["currency"] ?? "").toUpperCase(),
        merchantCategoryCode: value["merchantCategoryCode"] ?? null,
        merchantName: value["merchantName"] ?? null,
      });
    })(),
  };
}

async function setWorkerClaim(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select public.hermes_set_payment_worker_claim()`);
}

function port(transaction: Transaction): PaymentAuthorizationTransactionPort {
  return {
    databaseTime: async () => {
      const result = await transaction.execute(sql`select clock_timestamp() as current_time`);
      return asDate((result.rows[0] as { current_time: Date | string }).current_time);
    },
    lookupCard: async (rail, railCardId) => {
      const result = await transaction.execute(sql`
        select * from public.hermes_payment_card_context(${rail}, ${railCardId})
      `);
      return readCard(result.rows[0] as Record<string, unknown> | undefined);
    },
    lockAgent: async (agentId) => {
      await transaction.execute(sql`select pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('hermes.agent:' || ${agentId}::text, 0)
      )`);
    },
    findReplay: async (rail, eventId, railAuthorizationId) => {
      const result = await transaction.execute(sql`
        select * from public.hermes_payment_replay(${rail}, ${eventId}, ${railAuthorizationId})
      `);
      return readReplay(result.rows[0] as Record<string, unknown> | undefined);
    },
    lookupMandate: async (context, mandateId) => {
      if (!mandateId) return null;
      const result = await transaction.execute(sql`
        select * from public.hermes_payment_mandate_context(
          ${mandateId}::uuid, ${context.agentId}::uuid, ${context.organizationId}::uuid
        )
      `);
      return readMandate(result.rows[0] as Record<string, unknown> | undefined);
    },
    getActivePolicy: async (agentId, organizationId) => {
      const result = await transaction.execute(sql`
        select * from public.hermes_payment_policy_context(
          ${agentId}::uuid, ${organizationId}::uuid
        )
      `);
      return readPolicy(result.rows[0] as Record<string, unknown> | undefined);
    },
    getSpendTotals: async (agentId, organizationId, now) => {
      const result = await transaction.execute(sql`
        with boundary as (
          select
            date_trunc('day', ${now}::timestamptz at time zone 'Asia/Hong_Kong')
              at time zone 'Asia/Hong_Kong' as day_start,
            date_trunc('month', ${now}::timestamptz at time zone 'Asia/Hong_Kong')
              at time zone 'Asia/Hong_Kong' as month_start
        )
        select spent_today_cents, spent_month_cents
        from public.hermes_payment_spend_totals(
          ${agentId}::uuid, ${organizationId}::uuid,
          (select day_start from boundary), (select month_start from boundary)
        )
      `);
      const row = result.rows[0] as
        { spent_today_cents?: number | string; spent_month_cents?: number | string } | undefined;
      return {
        dailySpendCents: Number(row?.spent_today_cents ?? 0),
        monthlySpendCents: Number(row?.spent_month_cents ?? 0),
      };
    },
    consumeMandate: async (mandateId, agentId, organizationId, now) => {
      const result = await transaction.execute(sql`
        select public.hermes_consume_payment_mandate(
          ${mandateId}::uuid, ${agentId}::uuid, ${organizationId}::uuid, ${now}::timestamptz
        ) as consumed
      `);
      return Boolean((result.rows[0] as { consumed?: boolean } | undefined)?.consumed);
    },
    insertAuthorization: async (input: PaymentAuthorizationInsert) => {
      const payload = {
        ...input,
        receivedAt: input.receivedAt.toISOString(),
        decidedAt: input.decidedAt.toISOString(),
      };
      const result = await transaction.execute(sql`
        select * from public.hermes_record_payment_authorization(${JSON.stringify(payload)}::jsonb)
      `);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error("PAYMENT_UNAVAILABLE");
      return {
        authorizationId: String(row["id"]),
        approved: row["decision"] === "allow",
        reasonCode: String(row["reason_code"]),
        reason: String(row["reason"]),
        mandateId: row["mandate_id"] == null ? null : String(row["mandate_id"]),
        policyVersion: row["policy_version"] == null ? null : Number(row["policy_version"]),
        decidedAt: asDate(row["decided_at"] as Date | string).toISOString(),
        latencyMs: Number(row["latency_ms"]),
        fingerprint: JSON.stringify({
          rail: input.rail,
          eventId: input.eventId,
          railAuthorizationId: input.railAuthorizationId,
          railCardId: input.railCardId,
          mandateId: input.mandateId,
          amountCents: input.amountCents,
          currency: input.currency,
          merchantCategoryCode: input.merchantCategoryCode,
          merchantName: input.merchantName,
        }),
      };
    },
    appendAudit: async (input) => {
      await transaction.execute(sql`
        select public.hermes_append_payment_audit(${JSON.stringify({
          organizationId: input.organizationId,
          agentId: input.agentId,
          action: input.action,
          decision: input.decision,
          amountCents: input.amountCents,
          summary: `${input.action}: ${input.payload["reasonCode"] ?? "payment decision"}`,
          occurredAt: input.occurredAt.toISOString(),
          payload: input.payload,
        })}::jsonb)
      `);
    },
  };
}

export type AuthorizationTransactionRunner = <T>(
  callback: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const runPublicTransaction: AuthorizationTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

export function createPostgresAuthorizationStore(
  runTransaction: AuthorizationTransactionRunner = runPublicTransaction,
): PaymentAuthorizationStore {
  return {
    transaction: async (callback) =>
      runTransaction(async (transaction) => {
        await setWorkerClaim(transaction);
        return callback(port(transaction));
      }),
  };
}

export function createMemoryAuthorizationStore(
  resolver: (input: PaymentAuthorizationInput) => Promise<PaymentDecision>,
): PaymentAuthorizationStore {
  return { authorize: resolver };
}
