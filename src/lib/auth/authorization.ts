import { eq } from "drizzle-orm";

import { orgMembers, organizations } from "@/db/schema";
import { withUserTransaction, type Transaction } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import {
  AuthRequiredError,
  MembershipRequiredError,
  PermissionDeniedError,
} from "@/lib/auth/errors";

export {
  AuthRequiredError,
  MembershipRequiredError,
  PermissionDeniedError,
} from "@/lib/auth/errors";

export type MemberRole = "owner" | "admin" | "viewer";

export type Actor = {
  userId: string;
  email: string | null;
  name: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: MemberRole;
};

export async function getCurrentActor(): Promise<Actor | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const membership = await withUserTransaction(user.id, async (tx) => {
    const rows = await tx
      .select({
        organizationId: orgMembers.organizationId,
        role: orgMembers.role,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.organizationId, organizations.id))
      .where(eq(orgMembers.userId, user.id))
      .limit(2);

    if (rows.length !== 1) return null;
    return rows[0];
  });

  if (!membership) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    organizationSlug: membership.organizationSlug,
    role: membership.role,
  };
}

export async function requireActor(): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) throw new AuthRequiredError();
  const actor = await getCurrentActor();
  if (!actor) throw new MembershipRequiredError();
  return actor;
}

export function assertCanMutate(actor: Actor): void {
  if (actor.role !== "owner" && actor.role !== "admin") throw new PermissionDeniedError();
}

export function withActorTransaction<T>(actor: Actor, callback: (tx: Transaction) => Promise<T>) {
  return withUserTransaction(actor.userId, callback);
}
