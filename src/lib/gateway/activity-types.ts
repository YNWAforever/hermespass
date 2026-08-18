import type { ApprovalStatus, TelegramDeliveryState } from "@/lib/approvals/service";

export type GatewayActivityDecision = "allow" | "hold" | "deny";

export type GatewayActivityItem = {
  id: string;
  agentId: string;
  agentSlug: string;
  agentName: string;
  agentDid: string;
  timestamp: string;
  tool: string;
  summary: string;
  amountCents: number | null;
  currency: string | null;
  decision: GatewayActivityDecision;
  reason: string;
  requestDigest: string;
  keyThumbprint: string;
  policyVersion: number | null;
  approvalId: string | null;
  approvalStatus: ApprovalStatus | null;
  assignedReviewerUserId: string | null;
  assignedReviewerName: string | null;
  assignedReviewerEmail: string | null;
  authorizationExpiresAt: string | null;
  telegramDeliveryState: TelegramDeliveryState | null;
};

export type GatewayDecisionTrendPoint = {
  hour: string;
  allow: number;
  hold: number;
  deny: number;
};

export type GatewayActivityAggregates = {
  actionsToday: number;
  pendingHolds: number;
  blockedSpendCents: number;
  deniedCount: number;
  decisionCounts: Record<GatewayActivityDecision, number>;
  trend: GatewayDecisionTrendPoint[];
};

export type GatewayActivityResponse = {
  activity: GatewayActivityItem[];
  aggregates: GatewayActivityAggregates;
};
