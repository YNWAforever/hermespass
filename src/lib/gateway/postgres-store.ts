import { and, eq, sql } from "drizzle-orm";

import { agentAuditLogs, agentPolicies, gatewayRequests, pendingApprovals } from "@/db/schema";
import { withPublicDatabase, type Transaction } from "@/lib/db";
import type {
  GatewayAuditInput,
  GatewayAuthContext,
  GatewayInsertInput,
  GatewayStore,
  GatewayTransactionPort,
  PendingApprovalInsertInput,
  StoredGatewayDecision,
} from "@/lib/gateway/service";
import type { GatewayPolicy } from "@/lib/policy/engine";

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function buffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

class PostgresGatewayTransaction implements GatewayTransactionPort {
  constructor(private readonly transaction: Transaction) {}

  async lookupAuthContext(agentDid: string, keyId: string): Promise<GatewayAuthContext | null> {
    const result = await this.transaction.execute(sql`
      select agent_id, organization_id, key_id, public_jwk, thumbprint,
        agent_status, key_status, passport_expires_at, scopes,
        spend_cap_cents, risk
      from hermes_gateway_auth_context(${agentDid}, ${keyId}::uuid)
    `);
    const row = result.rows[0] as
      | {
          agent_id: string;
          organization_id: string;
          key_id: string;
          public_jwk: unknown;
          thumbprint: string;
          agent_status: "active" | "revoked";
          key_status: "active" | "revoked";
          passport_expires_at: Date | string;
          scopes: string[];
          spend_cap_cents: number | string;
          risk: "low" | "medium" | "high";
        }
      | undefined;
    if (!row) return null;
    return {
      agentId: row.agent_id,
      organizationId: row.organization_id,
      keyId: row.key_id,
      publicJwk: row.public_jwk,
      thumbprint: row.thumbprint,
      agentStatus: row.agent_status,
      keyStatus: row.key_status,
      passportExpiresAt: date(row.passport_expires_at),
      scopes: row.scopes,
      spendCapCents: Number(row.spend_cap_cents),
      risk: row.risk,
    };
  }

  async setSignatureAuthenticatedClaim(context: GatewayAuthContext): Promise<void> {
    await this.transaction.execute(sql`
      select hermes_set_signature_authenticated_agent_claim(
        ${context.agentId}::uuid,
        ${context.organizationId}::uuid,
        ${context.keyId}::uuid
      )
    `);
  }

  async databaseTime(): Promise<Date> {
    const result = await this.transaction.execute(sql`select clock_timestamp() as current_time`);
    const row = result.rows[0] as { current_time: Date | string } | undefined;
    if (!row) throw new Error("GATEWAY_TIME_UNAVAILABLE");
    return date(row.current_time);
  }

  async findByNonce(agentId: string, nonce: string): Promise<StoredGatewayDecision | null> {
    const rows = await this.transaction
      .select({
        requestId: gatewayRequests.id,
        requestDigest: gatewayRequests.requestDigest,
        signatureDigest: gatewayRequests.signatureDigest,
        currentDecision: gatewayRequests.currentDecision,
        reasonCode: gatewayRequests.reasonCode,
        reason: gatewayRequests.reason,
        policyVersion: gatewayRequests.policyVersion,
        decidedAt: gatewayRequests.decidedAt,
        currentResultUpdatedAt: gatewayRequests.currentResultUpdatedAt,
        authorizationExpiresAt: gatewayRequests.authorizationExpiresAt,
        approvalId: pendingApprovals.id,
        approvalExpiresAt: pendingApprovals.expiresAt,
      })
      .from(gatewayRequests)
      .leftJoin(pendingApprovals, eq(pendingApprovals.gatewayRequestId, gatewayRequests.id))
      .where(and(eq(gatewayRequests.agentId, agentId), eq(gatewayRequests.nonce, nonce)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      requestDigest: buffer(row.requestDigest),
      signatureDigest: buffer(row.signatureDigest),
      decidedAt: date(row.decidedAt),
      currentResultUpdatedAt: date(row.currentResultUpdatedAt),
      authorizationExpiresAt: row.authorizationExpiresAt ? date(row.authorizationExpiresAt) : null,
      approvalExpiresAt: row.approvalExpiresAt ? date(row.approvalExpiresAt) : null,
    };
  }

  async lockGatewayDecision(context: GatewayAuthContext): Promise<void> {
    await this.transaction.execute(sql`
      select hermes_lock_gateway_signature_agent(
        ${context.agentId}::uuid,
        ${context.organizationId}::uuid,
        ${context.keyId}::uuid
      )
    `);
  }

  async getActivePolicy(agentId: string, organizationId: string): Promise<GatewayPolicy | null> {
    const rows = await this.transaction
      .select()
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.agentId, agentId),
          eq(agentPolicies.organizationId, organizationId),
          eq(agentPolicies.isActive, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      version: row.version,
      currency: row.currency as "HKD",
      perTransactionLimitCents: row.perTransactionLimitCents,
      dailyLimitCents: row.dailyLimitCents,
      monthlyLimitCents: row.monthlyLimitCents,
      approvalThresholdCents: row.approvalThresholdCents,
      mccAllowlist: row.mccAllowlist,
      mccRequired: row.mccRequired,
      assignedReviewerUserId: row.assignedReviewerUserId,
    };
  }

  async getSpendTotals(
    agentId: string,
  ): Promise<{ dailySpendCents: number; monthlySpendCents: number }> {
    const result = await this.transaction.execute(sql`
      with boundary as (
        select
          date_trunc('day', clock_timestamp() at time zone 'Asia/Hong_Kong')
            at time zone 'Asia/Hong_Kong' as day_start,
          date_trunc('month', clock_timestamp() at time zone 'Asia/Hong_Kong')
            at time zone 'Asia/Hong_Kong' as month_start
      )
      select
        coalesce(sum(request.amount_cents) filter (
          where request.authorized_at >= boundary.day_start
        ), 0)::text as daily_spend_cents,
        coalesce(sum(request.amount_cents) filter (
          where request.authorized_at >= boundary.month_start
        ), 0)::text as monthly_spend_cents
      from gateway_requests request
      cross join boundary
      where request.agent_id = ${agentId}::uuid
        and request.current_decision = 'allow'
        and request.amount_cents is not null
        and request.authorized_at >= boundary.month_start
    `);
    const row = result.rows[0] as
      { daily_spend_cents: string; monthly_spend_cents: string } | undefined;
    return {
      dailySpendCents: Number(row?.daily_spend_cents ?? 0),
      monthlySpendCents: Number(row?.monthly_spend_cents ?? 0),
    };
  }

  async insertGatewayRequest(input: GatewayInsertInput): Promise<StoredGatewayDecision> {
    const rows = await this.transaction
      .insert(gatewayRequests)
      .values({
        organizationId: input.organizationId,
        agentId: input.agentId,
        keyId: input.keyId,
        nonce: input.nonce,
        requestDigest: input.requestDigest,
        payloadDigest: input.payloadDigest,
        signatureDigest: input.signatureDigest,
        actionVersion: input.actionVersion,
        tool: input.tool,
        summary: input.summary,
        justification: input.justification,
        amountCents: input.amountCents,
        currency: input.currency,
        merchantCategoryCode: input.merchantCategoryCode,
        signedAt: input.signedAt,
        receivedAt: input.receivedAt,
        decision: input.decision,
        currentDecision: input.decision,
        reasonCode: input.reasonCode,
        reason: input.reason,
        policyVersion: input.policyVersion,
        decidedAt: input.decidedAt,
        currentResultUpdatedAt: input.decidedAt,
        authorizedAt: input.authorizedAt,
        authorizationExpiresAt: input.authorizationExpiresAt,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("GATEWAY_INSERT_FAILED");
    return {
      requestId: row.id,
      requestDigest: buffer(row.requestDigest),
      signatureDigest: buffer(row.signatureDigest),
      currentDecision: row.currentDecision,
      reasonCode: row.reasonCode,
      reason: row.reason,
      policyVersion: row.policyVersion,
      approvalId: null,
      decidedAt: date(row.decidedAt),
      currentResultUpdatedAt: date(row.currentResultUpdatedAt),
      authorizationExpiresAt: row.authorizationExpiresAt ? date(row.authorizationExpiresAt) : null,
      approvalExpiresAt: null,
    };
  }

  async insertPendingApproval(input: PendingApprovalInsertInput): Promise<string> {
    const rows = await this.transaction
      .insert(pendingApprovals)
      .values({
        organizationId: input.organizationId,
        agentId: input.agentId,
        gatewayRequestId: input.gatewayRequestId,
        assignedReviewerUserId: input.assignedReviewerUserId,
        status: "pending",
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        telegramDeliveryState: "not_requested",
      })
      .returning({ id: pendingApprovals.id });
    const row = rows[0];
    if (!row) throw new Error("APPROVAL_INSERT_FAILED");
    return row.id;
  }

  async appendAudit(input: GatewayAuditInput): Promise<void> {
    await this.transaction.insert(agentAuditLogs).values({
      organizationId: input.organizationId,
      agentId: input.agentId,
      actorType: "agent",
      actorId: input.agentId,
      action: input.action,
      summary: input.summary,
      decision: input.decision,
      tool: input.tool,
      amountCents: input.amountCents,
      payload: input.payload,
      occurredAt: input.occurredAt,
      hash: Buffer.alloc(32),
    });
  }
}

export type GatewayTransactionRunner = <T>(
  callback: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const runPublicTransaction: GatewayTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

export function createPostgresGatewayStore(
  runTransaction: GatewayTransactionRunner = runPublicTransaction,
): GatewayStore {
  return {
    transaction: async <T>(callback: (transaction: GatewayTransactionPort) => Promise<T>) =>
      runTransaction((transaction) => callback(new PostgresGatewayTransaction(transaction))),
  };
}
