import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { agentAuditLogs, agentPolicies, agents, orgMembers } from "@/db/schema";
import { assertCanMutate, type Actor, withActorTransaction } from "@/lib/auth/authorization";
import { policyDto, policyInputSchema, type PolicyDto } from "@/lib/policies/types";

export type MemberDto = {
  userId: string;
  nameSnapshot: string | null;
  emailSnapshot: string | null;
  role: "owner" | "admin" | "viewer";
  active: boolean;
};

export async function listMembers(actor: Actor): Promise<MemberDto[]> {
  return withActorTransaction(actor, async (tx) =>
    tx
      .select({
        userId: orgMembers.userId,
        nameSnapshot: orgMembers.nameSnapshot,
        emailSnapshot: orgMembers.emailSnapshot,
        role: orgMembers.role,
        active: sql<boolean>`true`.as("active"),
      })
      .from(orgMembers)
      .where(eq(orgMembers.organizationId, actor.organizationId))
      .orderBy(orgMembers.nameSnapshot, orgMembers.emailSnapshot),
  );
}

export async function getAgentPolicy(actor: Actor, agentId: string): Promise<PolicyDto | null> {
  return withActorTransaction(actor, async (tx) => {
    const agent = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organizationId, actor.organizationId)))
      .limit(1);
    if (!agent[0]) throw new Error("AGENT_NOT_FOUND");

    const policies = await tx
      .select()
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.agentId, agentId),
          eq(agentPolicies.organizationId, actor.organizationId),
        ),
      )
      .orderBy(desc(agentPolicies.isActive), desc(agentPolicies.version))
      .limit(1);
    return policies[0] ? policyDto(policies[0]) : null;
  });
}

export async function putAgentPolicy(
  actor: Actor,
  agentId: string,
  input: unknown,
): Promise<PolicyDto> {
  assertCanMutate(actor);
  const policy = policyInputSchema.parse(input);

  try {
    return await withActorTransaction(actor, async (tx) => {
      await tx.execute(sql`
        select hermes_lock_policy_version(
          ${agentId}::uuid,
          ${actor.organizationId}::uuid
        )
      `);

      const reviewer = await tx
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.organizationId, actor.organizationId),
            eq(orgMembers.userId, policy.assignedReviewerUserId),
            inArray(orgMembers.role, ["owner", "admin"]),
          ),
        )
        .limit(1);
      if (!reviewer[0]) throw new Error("POLICY_REVIEWER_INELIGIBLE");

      const versions = await tx
        .select({ version: agentPolicies.version })
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.agentId, agentId),
            eq(agentPolicies.organizationId, actor.organizationId),
          ),
        )
        .orderBy(desc(agentPolicies.version))
        .limit(1);
      const active = await tx
        .select()
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.agentId, agentId),
            eq(agentPolicies.organizationId, actor.organizationId),
            eq(agentPolicies.isActive, true),
          ),
        )
        .limit(1);
      const now = new Date();

      if (active[0]) {
        await tx
          .update(agentPolicies)
          .set({ isActive: false, supersededAt: now })
          .where(eq(agentPolicies.id, active[0].id));
        await tx.insert(agentAuditLogs).values({
          organizationId: actor.organizationId,
          agentId,
          actorType: "user",
          actorId: actor.userId,
          action: "policy.superseded",
          summary: `Agent policy version ${active[0].version} superseded`,
          decision: "allow",
          tool: "policy.manage",
          payload: { version: active[0].version },
          hash: Buffer.alloc(32),
        });
      }

      const inserted = await tx
        .insert(agentPolicies)
        .values({
          organizationId: actor.organizationId,
          agentId,
          version: (versions[0]?.version ?? 0) + 1,
          ...policy,
          isActive: true,
          supersededAt: null,
          createdByUserId: actor.userId,
          createdAt: now,
        })
        .returning();
      const created = inserted[0];
      if (!created) throw new Error("POLICY_UPDATE_FAILED");

      await tx.insert(agentAuditLogs).values({
        organizationId: actor.organizationId,
        agentId,
        actorType: "user",
        actorId: actor.userId,
        action: "policy.created",
        summary: `Agent policy version ${created.version} created`,
        decision: "allow",
        tool: "policy.manage",
        payload: {
          version: created.version,
          currency: created.currency,
          perTransactionLimitCents: created.perTransactionLimitCents,
          dailyLimitCents: created.dailyLimitCents,
          monthlyLimitCents: created.monthlyLimitCents,
          approvalThresholdCents: created.approvalThresholdCents,
          mccAllowlist: created.mccAllowlist,
          mccRequired: created.mccRequired,
          assignedReviewerUserId: created.assignedReviewerUserId,
        },
        hash: Buffer.alloc(32),
      });

      return policyDto(created);
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "POLICY_REVIEWER_INELIGIBLE" || error.message === "POLICY_UPDATE_FAILED")
    ) {
      throw error;
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "42501") throw new Error("AGENT_NOT_FOUND");
    if (code === "23514") throw new Error("POLICY_REVIEWER_INELIGIBLE");
    throw new Error("POLICY_UPDATE_FAILED");
  }
}
