import { sql } from "drizzle-orm";

import { withUserTransaction } from "@/lib/db";
import { normalizeOrganizationInput } from "@/lib/orgs/validation";

export type OrganizationActor = {
  userId: string;
  email: string | null;
  name: string | null;
};

export type OrganizationDto = {
  id: string;
  name: string;
  slug: string;
  tier: "pilot";
  role: "owner";
};

export async function createOrganization(
  actor: OrganizationActor,
  input: { name: string; slug: string },
): Promise<OrganizationDto> {
  const normalized = normalizeOrganizationInput(input);
  try {
    return await withUserTransaction(actor.userId, async (tx) => {
      const result = await tx.execute(sql`
        select id, slug
        from public.hermes_create_organization(
          ${normalized.name},
          ${normalized.slug},
          ${actor.userId},
          ${actor.email ?? ""},
          ${actor.name ?? ""}
        )
      `);
      const row = result.rows[0] as { id?: string; slug?: string } | undefined;
      if (!row?.id || !row.slug) throw new Error("ORGANIZATION_UNAVAILABLE");
      return {
        id: row.id,
        name: normalized.name,
        slug: row.slug,
        tier: "pilot",
        role: "owner",
      };
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "23505" || messageOf(error) === "ORGANIZATION_MEMBERSHIP_EXISTS") {
      throw new Error("ORGANIZATION_MEMBERSHIP_EXISTS");
    }
    if (messageOf(error).includes("organizations_slug_key")) {
      throw new Error("ORGANIZATION_SLUG_TAKEN");
    }
    if (messageOf(error) === "ORGANIZATION_INVALID") throw error;
    throw new Error("ORGANIZATION_UNAVAILABLE");
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
