import type { Actor } from "@/lib/auth/authorization";
import { PermissionDeniedError } from "@/lib/auth/errors";
import { createPostgresApprovalStore } from "@/lib/approvals/postgres-store";

export type ApprovalDecision = "allow" | "deny";
export type ApprovalResolutionSource = "web" | "telegram" | "expiry" | "owner_override";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type TelegramDeliveryState = "not_requested" | "pending" | "sent" | "failed";

export type ApprovalDto = {
  id: string;
  gatewayRequestId: string;
  agentId: string;
  agentName: string;
  agentDid: string;
  tool: string;
  summary: string;
  amountCents: number | null;
  currency: string | null;
  merchantCategoryCode: string | null;
  requestDigest: string;
  keyThumbprint: string;
  policyVersion: number | null;
  assignedReviewerUserId: string;
  assignedReviewerName: string | null;
  assignedReviewerEmail: string | null;
  status: ApprovalStatus;
  resolution: ApprovalDecision | null;
  resolutionSource: ApprovalResolutionSource | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
  expiresAt: string;
  authorizationExpiresAt: string | null;
  telegramDeliveryState: TelegramDeliveryState;
  telegramDeliveryAttempts: number;
  telegramLastAttemptAt: string | null;
  telegramDeliveredAt: string | null;
  telegramLastErrorCode: string | null;
  createdAt: string;
};

export type TelegramApprovalIdentity = {
  telegramUserId: number;
  telegramChatId: number;
};

export type ApprovalResolutionRequest = {
  approvalId: string;
  decision: ApprovalDecision;
  source: ApprovalResolutionSource;
  reason: string;
  actorUserId: string | null;
  telegramIdentity?: TelegramApprovalIdentity;
};

export type ApprovalResolutionRecord = {
  approvalId: string;
  gatewayRequestId: string;
  status: Exclude<ApprovalStatus, "pending">;
  decision: ApprovalDecision;
};

export type ApprovalResolutionDto = ApprovalResolutionRecord & {
  source: ApprovalResolutionSource;
};

export interface ApprovalResolutionTransaction {
  resolve(input: Omit<ApprovalResolutionRequest, "actorUserId">): Promise<ApprovalResolutionRecord>;
}

export interface ApprovalResolutionStore {
  transaction<T>(
    actorUserId: string | null,
    callback: (transaction: ApprovalResolutionTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface ApprovalServiceStore extends ApprovalResolutionStore {
  list(actorUserId: string, organizationId: string): Promise<ApprovalDto[]>;
}

export class ApprovalServiceError extends Error {
  constructor(
    readonly code: "APPROVAL_UNAVAILABLE" | "APPROVAL_RESOLUTION_INVALID" | "APPROVALS_UNAVAILABLE",
    readonly status: 400 | 409 | 503,
  ) {
    super(code);
    this.name = "ApprovalServiceError";
  }
}

function validateResolution(input: ApprovalResolutionRequest): void {
  const identity = input.telegramIdentity;
  const validTelegramIdentity =
    identity !== undefined &&
    Number.isSafeInteger(identity.telegramUserId) &&
    identity.telegramUserId > 0 &&
    Number.isSafeInteger(identity.telegramChatId) &&
    identity.telegramChatId === identity.telegramUserId;

  if (
    input.reason.trim().length < 1 ||
    input.reason.length > 1000 ||
    (input.source === "expiry" && (input.actorUserId !== null || input.decision !== "deny")) ||
    (input.source !== "expiry" && !input.actorUserId) ||
    (input.source === "telegram" && !validTelegramIdentity) ||
    (input.source !== "telegram" && identity !== undefined)
  ) {
    throw new ApprovalServiceError("APPROVAL_RESOLUTION_INVALID", 400);
  }
}

export async function resolveApproval(
  input: ApprovalResolutionRequest,
  store: ApprovalResolutionStore = createPostgresApprovalStore(),
): Promise<ApprovalResolutionDto> {
  validateResolution(input);
  const resolved = await store.transaction(input.actorUserId, (transaction) =>
    transaction.resolve({
      approvalId: input.approvalId,
      decision: input.decision,
      source: input.source,
      reason: input.reason,
      ...(input.telegramIdentity ? { telegramIdentity: input.telegramIdentity } : {}),
    }),
  );
  return { ...resolved, source: input.source };
}

export async function listApprovals(
  actor: Actor,
  store: ApprovalServiceStore = createPostgresApprovalStore(),
): Promise<ApprovalDto[]> {
  return store.list(actor.userId, actor.organizationId);
}

export async function resolveWebApproval(
  actor: Actor,
  input: {
    approvalId: string;
    decision: ApprovalDecision;
    reason: string;
  },
  store: ApprovalResolutionStore = createPostgresApprovalStore(),
): Promise<ApprovalResolutionDto> {
  if (actor.role === "viewer") throw new PermissionDeniedError();
  return resolveApproval(
    {
      ...input,
      actorUserId: actor.userId,
      source: actor.role === "owner" ? "owner_override" : "web",
    },
    store,
  );
}
