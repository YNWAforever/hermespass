import type { GatewayActionV1 } from "@/lib/policy/action";

export type GatewayDecision = "allow" | "deny" | "hold";

export type GatewayPolicy = {
  version: number;
  currency: "HKD";
  perTransactionLimitCents: number;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  approvalThresholdCents: number;
  mccAllowlist: string[];
  mccRequired: boolean;
  assignedReviewerUserId: string;
};

export type GatewayPolicyContext = {
  now: Date;
  passport: {
    active: boolean;
    expiresAt: Date;
    scopes: string[];
    spendCapCents: number;
    risk: "low" | "medium" | "high";
  };
  keyActive: boolean;
  policy: GatewayPolicy | null;
  dailySpendCents: number;
  monthlySpendCents: number;
};

export type GatewayPolicyDecision = {
  decision: GatewayDecision;
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
};

const REASONS = {
  PASSPORT_INACTIVE: "The agent passport is inactive.",
  PASSPORT_EXPIRED: "The agent passport has expired.",
  AGENT_KEY_INACTIVE: "The signing key is inactive.",
  TOOL_OUT_OF_SCOPE: "The requested tool is outside the passport scope.",
  NON_SPEND_ALLOWED: "The in-scope non-spend action is authorized.",
  POLICY_REQUIRED: "An active spend policy is required.",
  CURRENCY_NOT_SUPPORTED: "Phase 2 spend authorization supports HKD only.",
  PASSPORT_SPEND_CAP_EXCEEDED: "The amount exceeds the passport spend cap.",
  MCC_REQUIRED: "A merchant category code is required by policy.",
  MCC_NOT_ALLOWED: "The merchant category code is not allowed by policy.",
  PER_TRANSACTION_LIMIT_EXCEEDED: "The amount exceeds the per-transaction limit.",
  DAILY_LIMIT_EXCEEDED: "The amount would exceed the daily limit.",
  MONTHLY_LIMIT_EXCEEDED: "The amount would exceed the monthly limit.",
  APPROVAL_REQUIRED: "The amount requires assigned human approval.",
  HIGH_RISK_REVIEW_REQUIRED: "High-risk agent spend requires assigned human approval.",
  POLICY_ALLOWED: "The action is authorized by the active policy.",
} as const;

function result(
  decision: GatewayDecision,
  reasonCode: keyof typeof REASONS,
  policyVersion: number | null,
): GatewayPolicyDecision {
  return { decision, reasonCode, reason: REASONS[reasonCode], policyVersion };
}

export function evaluateGatewayPolicy(
  action: GatewayActionV1,
  context: GatewayPolicyContext,
): GatewayPolicyDecision {
  if (!context.passport.active) return result("deny", "PASSPORT_INACTIVE", null);
  if (context.passport.expiresAt.getTime() <= context.now.getTime())
    return result("deny", "PASSPORT_EXPIRED", null);
  if (!context.keyActive) return result("deny", "AGENT_KEY_INACTIVE", null);
  if (!context.passport.scopes.includes(action.tool))
    return result("deny", "TOOL_OUT_OF_SCOPE", null);
  if (action.amountCents === null) return result("allow", "NON_SPEND_ALLOWED", null);

  const policy = context.policy;
  if (!policy) return result("deny", "POLICY_REQUIRED", null);
  if (action.currency !== "HKD") return result("deny", "CURRENCY_NOT_SUPPORTED", policy.version);
  if (action.amountCents > context.passport.spendCapCents)
    return result("deny", "PASSPORT_SPEND_CAP_EXCEEDED", policy.version);
  if (policy.mccRequired && action.merchantCategoryCode === null)
    return result("deny", "MCC_REQUIRED", policy.version);
  if (
    action.merchantCategoryCode !== null &&
    policy.mccAllowlist.length > 0 &&
    !policy.mccAllowlist.includes(action.merchantCategoryCode)
  ) {
    return result("deny", "MCC_NOT_ALLOWED", policy.version);
  }
  if (action.amountCents > policy.perTransactionLimitCents)
    return result("deny", "PER_TRANSACTION_LIMIT_EXCEEDED", policy.version);
  if (context.dailySpendCents + action.amountCents > policy.dailyLimitCents)
    return result("deny", "DAILY_LIMIT_EXCEEDED", policy.version);
  if (context.monthlySpendCents + action.amountCents > policy.monthlyLimitCents)
    return result("deny", "MONTHLY_LIMIT_EXCEEDED", policy.version);
  if (action.amountCents > policy.approvalThresholdCents)
    return result("hold", "APPROVAL_REQUIRED", policy.version);
  if (context.passport.risk === "high")
    return result("hold", "HIGH_RISK_REVIEW_REQUIRED", policy.version);
  return result("allow", "POLICY_ALLOWED", policy.version);
}
