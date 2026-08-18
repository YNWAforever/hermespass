import { deliverCommittedApproval } from "@/lib/gateway/approval-delivery";
import { createPostgresGatewayStore } from "@/lib/gateway/postgres-store";
import {
  gatewayRequestDigests,
  verifyGatewaySignature,
  type SignedGatewayRequest,
} from "@/lib/policy/action";
import {
  evaluateGatewayPolicy,
  type GatewayDecision,
  type GatewayPolicy,
} from "@/lib/policy/engine";
import { gatewayTimeState } from "@/lib/policy/time";

export type GatewayDecisionDto = {
  requestId: string;
  decision: GatewayDecision;
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
  approvalId: string | null;
  decidedAt: string;
  authorizationExpiresAt: string | null;
  retryAfterSeconds: number | null;
};

export type GatewayAuthContext = {
  agentId: string;
  organizationId: string;
  keyId: string;
  publicJwk: unknown;
  thumbprint: string;
  agentStatus: "active" | "revoked";
  keyStatus: "active" | "revoked";
  passportExpiresAt: Date;
  scopes: string[];
  spendCapCents: number;
  risk: "low" | "medium" | "high";
};

export type StoredGatewayDecision = {
  requestId: string;
  requestDigest: Buffer;
  signatureDigest: Buffer;
  currentDecision: GatewayDecision;
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
  approvalId: string | null;
  decidedAt: Date;
  currentResultUpdatedAt: Date;
  authorizationExpiresAt: Date | null;
  approvalExpiresAt: Date | null;
};

export type GatewayInsertInput = {
  organizationId: string;
  agentId: string;
  keyId: string;
  nonce: string;
  requestDigest: Buffer;
  payloadDigest: Buffer;
  signatureDigest: Buffer;
  actionVersion: "1";
  tool: SignedGatewayRequest["action"]["tool"];
  summary: string;
  justification: string | null;
  amountCents: number | null;
  currency: string | null;
  merchantCategoryCode: string | null;
  signedAt: Date;
  receivedAt: Date;
  decision: GatewayDecision;
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
  decidedAt: Date;
  authorizedAt: Date | null;
  authorizationExpiresAt: Date | null;
};

export type PendingApprovalInsertInput = {
  organizationId: string;
  agentId: string;
  gatewayRequestId: string;
  assignedReviewerUserId: string;
  expiresAt: Date;
  createdAt: Date;
};

export type GatewayAuditInput = {
  organizationId: string;
  agentId: string;
  action: "gateway.decision" | "approval.created";
  summary: string;
  decision: GatewayDecision;
  tool: string;
  amountCents: number | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export interface GatewayTransactionPort {
  lookupAuthContext(agentDid: string, keyId: string): Promise<GatewayAuthContext | null>;
  setSignatureAuthenticatedClaim(context: GatewayAuthContext): Promise<void>;
  databaseTime(): Promise<Date>;
  findByNonce(agentId: string, nonce: string): Promise<StoredGatewayDecision | null>;
  lockGatewayDecision(context: GatewayAuthContext): Promise<void>;
  getActivePolicy(agentId: string, organizationId: string): Promise<GatewayPolicy | null>;
  getSpendTotals(agentId: string): Promise<{ dailySpendCents: number; monthlySpendCents: number }>;
  insertGatewayRequest(input: GatewayInsertInput): Promise<StoredGatewayDecision>;
  insertPendingApproval(input: PendingApprovalInsertInput): Promise<string>;
  appendAudit(input: GatewayAuditInput): Promise<void>;
}

export interface GatewayStore {
  transaction<T>(callback: (transaction: GatewayTransactionPort) => Promise<T>): Promise<T>;
}

export class GatewayServiceError extends Error {
  constructor(
    readonly code: "AGENT_AUTH_FAILED" | "NONCE_CONFLICT" | "GATEWAY_UNAVAILABLE",
    readonly status: 401 | 409 | 503,
  ) {
    super(code);
    this.name = "GatewayServiceError";
  }
}

function exactReplay(
  stored: StoredGatewayDecision,
  requestDigest: Buffer,
  signatureDigest: Buffer,
): boolean {
  return (
    stored.requestDigest.equals(requestDigest) && stored.signatureDigest.equals(signatureDigest)
  );
}

function retryAfterSeconds(stored: StoredGatewayDecision, now: Date): number | null {
  if (stored.currentDecision !== "hold" || !stored.approvalExpiresAt) return null;
  return Math.max(0, Math.ceil((stored.approvalExpiresAt.getTime() - now.getTime()) / 1_000));
}

function toDecisionDto(stored: StoredGatewayDecision, now: Date): GatewayDecisionDto {
  if (
    stored.currentDecision === "allow" &&
    stored.authorizationExpiresAt &&
    stored.authorizationExpiresAt.getTime() <= now.getTime()
  ) {
    return {
      requestId: stored.requestId,
      decision: "deny",
      reasonCode: "AUTHORIZATION_EXPIRED",
      reason: "The stored authorization has expired.",
      policyVersion: stored.policyVersion,
      approvalId: stored.approvalId,
      decidedAt: stored.currentResultUpdatedAt.toISOString(),
      authorizationExpiresAt: null,
      retryAfterSeconds: null,
    };
  }

  return {
    requestId: stored.requestId,
    decision: stored.currentDecision,
    reasonCode: stored.reasonCode,
    reason: stored.reason,
    policyVersion: stored.policyVersion,
    approvalId: stored.approvalId,
    decidedAt: stored.currentResultUpdatedAt.toISOString(),
    authorizationExpiresAt: stored.authorizationExpiresAt?.toISOString() ?? null,
    retryAfterSeconds: retryAfterSeconds(stored, now),
  };
}

function replayOrConflict(
  stored: StoredGatewayDecision,
  requestDigest: Buffer,
  signatureDigest: Buffer,
  now: Date,
): GatewayDecisionDto {
  if (!exactReplay(stored, requestDigest, signatureDigest)) {
    throw new GatewayServiceError("NONCE_CONFLICT", 409);
  }
  return toDecisionDto(stored, now);
}

export async function decideGatewayRequestWithStore(
  request: SignedGatewayRequest,
  store: GatewayStore,
): Promise<GatewayDecisionDto> {
  return store.transaction(async (transaction) => {
    let auth = await transaction.lookupAuthContext(request.action.agentDid, request.action.keyId);
    if (
      !auth ||
      !(await verifyGatewaySignature(request.action, request.signature, auth.publicJwk))
    ) {
      throw new GatewayServiceError("AGENT_AUTH_FAILED", 401);
    }

    const receivedAt = await transaction.databaseTime();
    const receiptTime = gatewayTimeState(request.action.timestamp, receivedAt);

    const digests = gatewayRequestDigests(request);
    await transaction.lockGatewayDecision(auth);
    await transaction.setSignatureAuthenticatedClaim(auth);
    const lockedAuth = await transaction.lookupAuthContext(
      request.action.agentDid,
      request.action.keyId,
    );
    if (
      !lockedAuth ||
      lockedAuth.agentId !== auth.agentId ||
      lockedAuth.organizationId !== auth.organizationId ||
      !(await verifyGatewaySignature(request.action, request.signature, lockedAuth.publicJwk))
    ) {
      throw new GatewayServiceError("AGENT_AUTH_FAILED", 401);
    }
    auth = lockedAuth;

    const now = await transaction.databaseTime();
    const replay = await transaction.findByNonce(auth.agentId, request.action.nonce);
    if (replay) {
      return replayOrConflict(replay, digests.requestDigest, digests.signatureDigest, now);
    }

    const policy = await transaction.getActivePolicy(auth.agentId, auth.organizationId);
    const spend = await transaction.getSpendTotals(auth.agentId);
    const time = gatewayTimeState(request.action.timestamp, now);
    const evaluated = receiptTime.fresh
      ? evaluateGatewayPolicy(request.action, {
          now,
          passport: {
            active: auth.agentStatus === "active",
            expiresAt: auth.passportExpiresAt,
            scopes: auth.scopes,
            spendCapCents: auth.spendCapCents,
            risk: auth.risk,
          },
          keyActive: auth.keyStatus === "active",
          policy,
          ...spend,
        })
      : {
          decision: "deny" as const,
          reasonCode: "REQUEST_STALE",
          reason: "The signed action timestamp is outside the freshness window.",
          policyVersion: null,
        };
    const authorizedAt = evaluated.decision === "allow" ? now : null;
    const authorizationExpiresAt =
      evaluated.decision === "allow" ? time.authorizationExpiresAt : null;

    let stored = await transaction.insertGatewayRequest({
      organizationId: auth.organizationId,
      agentId: auth.agentId,
      keyId: auth.keyId,
      nonce: request.action.nonce,
      requestDigest: digests.requestDigest,
      payloadDigest: digests.payloadDigest,
      signatureDigest: digests.signatureDigest,
      actionVersion: request.action.version,
      tool: request.action.tool,
      summary: request.action.summary,
      justification: request.action.justification,
      amountCents: request.action.amountCents,
      currency: request.action.currency,
      merchantCategoryCode: request.action.merchantCategoryCode,
      signedAt: new Date(request.action.timestamp),
      receivedAt,
      decision: evaluated.decision,
      reasonCode: evaluated.reasonCode,
      reason: evaluated.reason,
      policyVersion: evaluated.policyVersion,
      decidedAt: now,
      authorizedAt,
      authorizationExpiresAt,
    });

    if (evaluated.decision === "hold") {
      if (!policy) throw new GatewayServiceError("GATEWAY_UNAVAILABLE", 503);
      const createdApprovalId = await transaction.insertPendingApproval({
        organizationId: auth.organizationId,
        agentId: auth.agentId,
        gatewayRequestId: stored.requestId,
        assignedReviewerUserId: policy.assignedReviewerUserId,
        expiresAt: time.holdExpiresAt,
        createdAt: now,
      });
      stored = {
        ...stored,
        approvalId: createdApprovalId,
        approvalExpiresAt: time.holdExpiresAt,
      };
    }

    const safeAuditPayload = {
      requestId: stored.requestId,
      requestDigest: digests.requestDigest.toString("base64url"),
      signatureDigest: digests.signatureDigest.toString("base64url"),
      payloadDigest: request.action.payloadDigest,
      keyId: auth.keyId,
      keyThumbprint: auth.thumbprint,
      policyVersion: evaluated.policyVersion,
      reasonCode: evaluated.reasonCode,
      authorizationExpiresAt: authorizationExpiresAt?.toISOString() ?? null,
    };
    await transaction.appendAudit({
      organizationId: auth.organizationId,
      agentId: auth.agentId,
      action: "gateway.decision",
      summary: `Gateway decision: ${evaluated.reasonCode}`,
      decision: evaluated.decision,
      tool: request.action.tool,
      amountCents: request.action.amountCents,
      payload: safeAuditPayload,
      occurredAt: now,
    });

    if (stored.approvalId) {
      await transaction.appendAudit({
        organizationId: auth.organizationId,
        agentId: auth.agentId,
        action: "approval.created",
        summary: "Assigned gateway approval created",
        decision: "hold",
        tool: request.action.tool,
        amountCents: request.action.amountCents,
        payload: {
          requestId: stored.requestId,
          approvalId: stored.approvalId,
          assignedReviewerUserId: policy?.assignedReviewerUserId ?? null,
          expiresAt: stored.approvalExpiresAt?.toISOString() ?? null,
        },
        occurredAt: now,
      });
    }

    return toDecisionDto(stored, now);
  });
}

export async function decideGatewayRequest(
  request: SignedGatewayRequest,
): Promise<GatewayDecisionDto> {
  try {
    return await deliverCommittedApproval(() =>
      decideGatewayRequestWithStore(request, createPostgresGatewayStore()),
    );
  } catch (error) {
    if (error instanceof GatewayServiceError) throw error;
    if (
      error instanceof Error &&
      error.message === "DATABASE_URL is required for database-backed requests"
    ) {
      throw error;
    }
    throw new GatewayServiceError("GATEWAY_UNAVAILABLE", 503);
  }
}
