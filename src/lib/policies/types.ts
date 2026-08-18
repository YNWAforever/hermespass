import { z } from "zod";

import type { AgentPolicyRow } from "@/db/schema";

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const policyInputSchema = z
  .object({
    currency: z.literal("HKD"),
    perTransactionLimitCents: cents,
    dailyLimitCents: cents,
    monthlyLimitCents: cents,
    approvalThresholdCents: cents,
    mccAllowlist: z
      .array(z.string().regex(/^\d{4}$/))
      .max(100)
      .refine((values) => new Set(values).size === values.length, {
        message: "MCC values must be unique",
      }),
    mccRequired: z.boolean(),
    assignedReviewerUserId: z.string().trim().min(1).max(255),
  })
  .superRefine((policy, context) => {
    if (policy.dailyLimitCents < policy.perTransactionLimitCents) {
      context.addIssue({
        code: "custom",
        path: ["dailyLimitCents"],
        message: "Daily limit must be at least the per-transaction limit",
      });
    }
    if (policy.monthlyLimitCents < policy.dailyLimitCents) {
      context.addIssue({
        code: "custom",
        path: ["monthlyLimitCents"],
        message: "Monthly limit must be at least the daily limit",
      });
    }
    if (policy.approvalThresholdCents > policy.perTransactionLimitCents) {
      context.addIssue({
        code: "custom",
        path: ["approvalThresholdCents"],
        message: "Approval threshold must not exceed the per-transaction limit",
      });
    }
    if (policy.mccRequired && policy.mccAllowlist.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["mccAllowlist"],
        message: "At least one MCC is required",
      });
    }
  });

export type PolicyInput = z.infer<typeof policyInputSchema>;

export type PolicyDto = {
  id: string;
  agentId: string;
  version: number;
  currency: "HKD";
  perTransactionLimitCents: number;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  approvalThresholdCents: number;
  mccAllowlist: string[];
  mccRequired: boolean;
  assignedReviewerUserId: string;
  isActive: boolean;
  supersededAt: string | null;
  createdAt: string;
};

export function policyDto(row: AgentPolicyRow): PolicyDto {
  return {
    id: row.id,
    agentId: row.agentId,
    version: row.version,
    currency: "HKD",
    perTransactionLimitCents: row.perTransactionLimitCents,
    dailyLimitCents: row.dailyLimitCents,
    monthlyLimitCents: row.monthlyLimitCents,
    approvalThresholdCents: row.approvalThresholdCents,
    mccAllowlist: row.mccAllowlist,
    mccRequired: row.mccRequired,
    assignedReviewerUserId: row.assignedReviewerUserId,
    isActive: row.isActive,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
