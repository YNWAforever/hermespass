import { createHash, randomBytes } from "node:crypto";

import { desc, eq, sql } from "drizzle-orm";

import { apiKeys } from "@/db/schema";
import type { Actor } from "@/lib/auth/authorization";

export type GeneratedApiKey = { key: string; prefix: string; hash: string };

export type ApiKeyDto = {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export function generateApiKey(): GeneratedApiKey {
  const key = `hp_live_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function createApiKey(
  actor: Actor,
  name: string,
): Promise<ApiKeyDto & { key: string }> {
  const { assertCanMutate, withActorTransaction } = await import("@/lib/auth/authorization");
  assertCanMutate(actor);
  const normalizedName = name.trim().replace(/\s+/g, " ");
  if (normalizedName.length < 2 || normalizedName.length > 120 || /[\u0000-\u001f]/.test(name)) {
    throw new Error("API_KEY_NAME_INVALID");
  }
  const generated = generateApiKey();
  try {
    return await withActorTransaction(actor, async (tx) => {
      const rows = await tx
        .insert(apiKeys)
        .values({
          organizationId: actor.organizationId,
          name: normalizedName,
          prefix: generated.prefix,
          keyHash: generated.hash,
          createdByUserId: actor.userId,
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          createdAt: apiKeys.createdAt,
          revokedAt: apiKeys.revokedAt,
          lastUsedAt: apiKeys.lastUsedAt,
        });
      const row = rows[0];
      if (!row) throw new Error("API_KEY_UNAVAILABLE");
      await tx.execute(sql`
        select public.hermes_productization_append_audit(
          ${actor.organizationId}::uuid,
          null::uuid,
          'human',
          ${actor.userId},
          'api_key.created',
          'Public verification API key created',
          jsonb_build_object('apiKeyId', ${row.id}::uuid, 'prefix', ${row.prefix})
        )
      `);
      return {
        ...mapApiKey(row),
        key: generated.key,
      };
    });
  } catch (error) {
    if (messageOf(error) === "API_KEY_UNAVAILABLE") throw error;
    throw new Error("API_KEY_UNAVAILABLE");
  }
}

export async function listApiKeys(actor: Actor): Promise<ApiKeyDto[]> {
  const { assertCanMutate, withActorTransaction } = await import("@/lib/auth/authorization");
  assertCanMutate(actor);
  return withActorTransaction(actor, async (tx) => {
    const rows = await tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        revokedAt: apiKeys.revokedAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, actor.organizationId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(mapApiKey);
  });
}

export async function revokeApiKey(actor: Actor, id: string): Promise<ApiKeyDto> {
  const { assertCanMutate, withActorTransaction } = await import("@/lib/auth/authorization");
  assertCanMutate(actor);
  try {
    return await withActorTransaction(actor, async (tx) => {
      const result = await tx.execute(sql`
        select id, name, prefix, created_at as "createdAt", revoked_at as "revokedAt", last_used_at as "lastUsedAt"
        from public.hermes_revoke_api_key(
          ${actor.organizationId}::uuid,
          ${id}::uuid,
          ${actor.userId}
        )
      `);
      const row = result.rows[0] as
        | {
            id: string;
            name: string;
            prefix: string;
            createdAt: Date;
            revokedAt: Date | null;
            lastUsedAt: Date | null;
          }
        | undefined;
      if (!row) throw new Error("API_KEY_NOT_FOUND");
      await tx.execute(sql`
        select public.hermes_productization_append_audit(
          ${actor.organizationId}::uuid,
          null::uuid,
          'human',
          ${actor.userId},
          'api_key.revoked',
          'Public verification API key revoked',
          jsonb_build_object('apiKeyId', ${row.id}::uuid, 'prefix', ${row.prefix})
        )
      `);
      return mapApiKey(row);
    });
  } catch (error) {
    if (messageOf(error) === "API_KEY_NOT_FOUND") throw error;
    throw new Error("API_KEY_UNAVAILABLE");
  }
}
function mapApiKey(row: {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    status: row.revokedAt ? "revoked" : "active",
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
