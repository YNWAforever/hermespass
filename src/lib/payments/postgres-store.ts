import { sql } from "drizzle-orm";

import { withPublicDatabase, type Transaction } from "@/lib/db";

export type PaymentAuthorizationInput = {
  organizationId: string;
  agentId: string;
  walletCardId: string;
  rail: string;
  eventId: string;
  railAuthorizationId: string;
  amountCents: number;
  currency: string;
  merchantCategoryCode?: string | null;
  merchantName?: string | null;
  mandateId?: string | null;
  decision: "allow" | "deny";
  status: "pending" | "approved" | "declined" | "reversed";
  reasonCode: string;
  reason: string;
  policyVersion?: number | null;
  latencyMs: number;
  receivedAt: Date;
  decidedAt: Date;
  reversedAt?: Date | null;
};

export type PaymentAuthorizationRow = {
  id: string;
  organizationId: string;
  agentId: string;
  walletCardId: string;
  rail: string;
  eventId: string;
  railAuthorizationId: string;
  amountCents: number;
  currency: string;
  merchantCategoryCode: string | null;
  merchantName: string | null;
  mandateId: string | null;
  decision: "allow" | "deny";
  status: "pending" | "approved" | "declined" | "reversed";
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
  latencyMs: number;
  receivedAt: Date;
  decidedAt: Date;
  reversedAt: Date | null;
};

export type PaymentSpendTotals = {
  spentTodayCents: number;
  spentMonthCents: number;
};

type PaymentTransactionCallback<T> = (transaction: Transaction) => Promise<T>;
export type PaymentTransactionRunner = <T>(callback: PaymentTransactionCallback<T>) => Promise<T>;

const defaultRunner: PaymentTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asPaymentRow(row: Record<string, unknown>): PaymentAuthorizationRow {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    agentId: String(row["agent_id"]),
    walletCardId: String(row["wallet_card_id"]),
    rail: String(row["rail"]),
    eventId: String(row["event_id"]),
    railAuthorizationId: String(row["rail_authorization_id"]),
    amountCents: Number(row["amount_cents"]),
    currency: String(row["currency"]),
    merchantCategoryCode: row["merchant_category_code"]
      ? String(row["merchant_category_code"])
      : null,
    merchantName: row["merchant_name"] ? String(row["merchant_name"]) : null,
    mandateId: row["mandate_id"] ? String(row["mandate_id"]) : null,
    decision: row["decision"] as PaymentAuthorizationRow["decision"],
    status: row["status"] as PaymentAuthorizationRow["status"],
    reasonCode: String(row["reason_code"]),
    reason: String(row["reason"]),
    policyVersion: row["policy_version"] === null ? null : Number(row["policy_version"]),
    latencyMs: Number(row["latency_ms"]),
    receivedAt: asDate(row["received_at"] as Date | string),
    decidedAt: asDate(row["decided_at"] as Date | string),
    reversedAt: row["reversed_at"] ? asDate(row["reversed_at"] as Date | string) : null,
  };
}

export async function lockPaymentAgent(transaction: Transaction, agentId: string): Promise<void> {
  const lockKey = "hermes.agent:" + agentId;
  await transaction.execute(sql`
    select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${lockKey}, 0)
    )
  `);
}

export function withPaymentTransaction<T>(
  callback: PaymentTransactionCallback<T>,
  runner: PaymentTransactionRunner = defaultRunner,
): Promise<T> {
  return runner(callback);
}

async function recordPaymentAuthorizationInTransaction(
  transaction: Transaction,
  input: PaymentAuthorizationInput,
): Promise<PaymentAuthorizationRow> {
  await lockPaymentAgent(transaction, input.agentId);
  const payload = {
    ...input,
    receivedAt: input.receivedAt.toISOString(),
    decidedAt: input.decidedAt.toISOString(),
    reversedAt: input.reversedAt?.toISOString() ?? null,
  };
  const result = await transaction.execute(sql`
    select * from public.hermes_record_payment_authorization(
      ${JSON.stringify(payload)}::jsonb
    )
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("PAYMENT_AUTHORIZATION_INSERT_FAILED");
  const stored = asPaymentRow(row);
  if (
    stored.amountCents !== input.amountCents ||
    stored.currency !== input.currency ||
    stored.agentId !== input.agentId
  ) {
    const error = new Error("PAYMENT_EVENT_CONFLICT") as Error & { code?: string };
    error.code = "23505";
    throw error;
  }
  return stored;
}

export async function recordPaymentAuthorization(
  input: PaymentAuthorizationInput,
  runner: PaymentTransactionRunner = defaultRunner,
): Promise<PaymentAuthorizationRow> {
  return withPaymentTransaction(
    (transaction) => recordPaymentAuthorizationInTransaction(transaction, input),
    runner,
  );
}

async function readPaymentSpendTotalsInTransaction(
  transaction: Transaction,
  agentId: string,
  organizationId: string,
  dayStart: Date,
  monthStart: Date,
): Promise<PaymentSpendTotals> {
  const result = await transaction.execute(sql`
    select spent_today_cents, spent_month_cents
    from public.hermes_payment_spend_totals(
      ${agentId}::uuid,
      ${organizationId}::uuid,
      ${dayStart}::timestamptz,
      ${monthStart}::timestamptz
    )
  `);
  const row = result.rows[0] as
    { spent_today_cents: number | string; spent_month_cents: number | string } | undefined;
  return {
    spentTodayCents: Number(row?.spent_today_cents ?? 0),
    spentMonthCents: Number(row?.spent_month_cents ?? 0),
  };
}

export async function readPaymentSpendTotals(
  agentId: string,
  organizationId: string,
  dayStart: Date,
  monthStart: Date,
  runner: PaymentTransactionRunner = defaultRunner,
): Promise<PaymentSpendTotals> {
  return withPaymentTransaction(
    (transaction) =>
      readPaymentSpendTotalsInTransaction(
        transaction,
        agentId,
        organizationId,
        dayStart,
        monthStart,
      ),
    runner,
  );
}
