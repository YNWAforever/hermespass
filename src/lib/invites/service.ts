import { sql } from "drizzle-orm";

import { orgInvites } from "@/db/schema";
import { assertCanMutate, type Actor, withActorTransaction } from "@/lib/auth/authorization";
import { withUserTransaction } from "@/lib/db";
import { createInviteToken, hashInviteToken, normalizeInviteEmail } from "@/lib/orgs/validation";

export type InviteActor = Pick<Actor, "userId" | "email">;

export async function createInvite(
  actor: Actor,
  input: { email: string; role: "admin" | "viewer" },
): Promise<{ id: string; prefix: string; urlPath: string; expiresAt: string }> {
  assertCanMutate(actor);
  if (input.role !== "admin" && input.role !== "viewer") throw new Error("INVITE_ROLE_INVALID");
  const email = normalizeInviteEmail(input.email);
  const token = createInviteToken();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 15 * 60 * 1000);

  try {
    return await withActorTransaction(actor, async (tx) => {
      const inserted = await tx
        .insert(orgInvites)
        .values({
          organizationId: actor.organizationId,
          email,
          role: input.role,
          tokenHash: token.hash,
          invitedByUserId: actor.userId,
          createdAt,
          expiresAt,
        })
        .returning({ id: orgInvites.id });
      const row = inserted[0];
      if (!row) throw new Error("INVITE_UNAVAILABLE");
      await tx.execute(sql`
        select public.hermes_productization_append_audit(
          ${actor.organizationId}::uuid,
          null::uuid,
          'human',
          ${actor.userId},
          'organization.invite.created',
          'Organization invite created',
          jsonb_build_object('inviteId', ${row.id}::uuid, 'email', ${email}, 'role', ${input.role})
        )
      `);
      return {
        id: row.id,
        prefix: token.raw.slice(0, 12),
        urlPath: `/invite/${token.raw}`,
        expiresAt: expiresAt.toISOString(),
      };
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "23505") throw new Error("INVITE_ALREADY_EXISTS");
    if (messageOf(error) === "INVITE_ROLE_INVALID") throw error;
    throw new Error("INVITE_UNAVAILABLE");
  }
}

export async function acceptInvite(
  actor: InviteActor,
  token: string,
): Promise<{ organizationId: string; role: "admin" | "viewer" }> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("INVITE_INVALID");
  if (!actor.email) throw new Error("INVITE_EMAIL_REQUIRED");
  try {
    return await withUserTransaction(actor.userId, async (tx) => {
      const result = await tx.execute(sql`
        select organization_id, role
        from public.hermes_accept_org_invite(
          ${hashInviteToken(token)}::bytea,
          ${actor.userId},
          ${normalizeInviteEmail(actor.email!)}
        )
      `);
      const row = result.rows[0] as
        { organization_id?: string; role?: "admin" | "viewer" } | undefined;
      if (!row?.organization_id || (row.role !== "admin" && row.role !== "viewer")) {
        throw new Error("INVITE_INVALID");
      }
      return { organizationId: row.organization_id, role: row.role };
    });
  } catch (error) {
    const message = messageOf(error);
    const code = errorCode(error);
    if (message === "INVITE_INVALID" || message === "INVITE_EMAIL_MISMATCH") throw error;
    if (message === "ORGANIZATION_MEMBERSHIP_EXISTS" || code === "23505") {
      throw new Error("ORGANIZATION_MEMBERSHIP_EXISTS");
    }
    if (code === "42501") throw new Error("INVITE_EMAIL_MISMATCH");
    throw new Error("INVITE_UNAVAILABLE");
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : "";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
