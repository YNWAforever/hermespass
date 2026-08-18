import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { agentAuditLogs, mandates } from "@/db/schema";
import { PermissionDeniedError } from "@/lib/auth/errors";
import type { Actor } from "@/lib/auth/authorization";
import { withPublicDatabase, withUserTransaction, type Transaction } from "@/lib/db";
import { canonicalMandateBytes, verifyMandate } from "@/lib/payments/mandates";
import type { MandateBodyV1, MandateVerificationKey, SignedMandateV1 } from "@/lib/payments/types";

export const MAX_MANDATE_BODY_BYTES = 16 * 1_024;

const signedMandateSchema = z
  .object({
    body: z
      .object({
        version: z.literal("1"),
        mandateId: z.string().uuid(),
        agentDid: z.string().regex(/^did:web:[^\s]+$/),
        keyId: z.string().uuid(),
        kind: z.enum(["intent", "cart"]),
        nonce: z.string().uuid(),
        issuedAt: z.string().datetime({ offset: true }),
        parentMandateId: z.string().uuid().nullable(),
        constraints: z
          .object({
            currency: z.literal("HKD"),
            maxAmountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            merchant: z.string().trim().min(1).max(255).nullable(),
            mccAllowlist: z.array(z.string().regex(/^\d{4}$/)).max(100),
            expiresAt: z.string().datetime({ offset: true }),
            oneTime: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    signature: z.string(),
  })
  .strict();

type AuthContext = {
  agentId: string;
  organizationId: string;
  keyId: string;
  publicJwk: JsonWebKey;
  thumbprint: string;
  agentStatus: "active" | "revoked";
  keyStatus: "active" | "revoked";
  passportExpiresAt: Date;
};

export type MandateDto = {
  id: string;
  agentDid: string;
  kind: "intent" | "cart";
  status: "active" | "consumed" | "revoked" | "expired";
  currency: "HKD";
  maxAmountCents: number;
  merchant: string | null;
  mccAllowlist: string[];
  parentMandateId: string | null;
  issuedAt: string;
  expiresAt: string;
  oneTime: boolean;
  bodyDigest: string;
  revokedAt?: string | null;
  consumedAt?: string | null;
};

export type MandateTransactionRunner = <T>(callback: (tx: Transaction) => Promise<T>) => Promise<T>;

export type MandateIssueResult = {
  mandate: MandateDto;
  replayed: boolean;
};

function assertCanMutate(actor: Actor): void {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new PermissionDeniedError();
  }
}

function withActorTransaction<T>(
  actor: Actor,
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withUserTransaction(actor.userId, callback);
}
export class MandateServiceError extends Error {
  constructor(
    readonly code:
      | "AGENT_AUTH_FAILED"
      | "NONCE_CONFLICT"
      | "MANDATE_PARENT_INVALID"
      | "MANDATE_NOT_FOUND"
      | "MANDATE_UNAVAILABLE",
  ) {
    super(code);
    this.name = "MandateServiceError";
  }
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function digest(value: Uint8Array | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

function digestString(value: Uint8Array | Buffer): string {
  return digest(value).toString("base64url");
}

function decodeSignature(signature: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) {
    throw new MandateServiceError("AGENT_AUTH_FAILED");
  }
  const decoded = Buffer.from(signature, "base64url");
  if (decoded.length !== 64 || decoded.toString("base64url") !== signature) {
    throw new MandateServiceError("AGENT_AUTH_FAILED");
  }
  return decoded;
}

function asAuthContext(row: Record<string, unknown> | undefined): AuthContext | null {
  if (!row) return null;
  return {
    agentId: String(row["agent_id"]),
    organizationId: String(row["organization_id"]),
    keyId: String(row["key_id"]),
    publicJwk: row["public_jwk"] as JsonWebKey,
    thumbprint: String(row["thumbprint"]),
    agentStatus: row["agent_status"] as AuthContext["agentStatus"],
    keyStatus: row["key_status"] as AuthContext["keyStatus"],
    passportExpiresAt: date(row["passport_expires_at"] as Date | string),
  };
}

async function lookupAuthContext(
  transaction: Transaction,
  agentDid: string,
  keyId: string,
): Promise<AuthContext | null> {
  const result = await transaction.execute(sqlAuthContext(agentDid, keyId));
  return asAuthContext(result.rows[0] as Record<string, unknown> | undefined);
}

function sqlAuthContext(agentDid: string, keyId: string) {
  // Keep the lookup on the reviewed SECURITY DEFINER boundary. It is the only
  // source of tenant identity and public key material for a signed mandate.
  return sql`
    select agent_id, organization_id, key_id, public_jwk, thumbprint,
      agent_status, key_status, passport_expires_at
    from public.hermes_gateway_auth_context(${agentDid}, ${keyId}::uuid)
  `;
}

function toMandateKey(context: AuthContext): MandateVerificationKey {
  return {
    id: context.keyId,
    agentId: context.agentId,
    agentDid: "",
    publicJwk: context.publicJwk,
    status: context.keyStatus,
    custody: "external",
  };
}

function lifecycleIsActive(context: AuthContext, now: Date): boolean {
  return (
    context.agentStatus === "active" &&
    context.keyStatus === "active" &&
    context.passportExpiresAt.getTime() > now.getTime()
  );
}

function assertSafeMandate(signed: SignedMandateV1): {
  body: MandateBodyV1;
  canonical: Uint8Array;
  signature: Buffer;
} {
  const parsed = signedMandateSchema.parse(signed) as SignedMandateV1;
  const canonical = canonicalMandateBytes(parsed.body);
  if (canonical.byteLength > MAX_MANDATE_BODY_BYTES) {
    throw new MandateServiceError("MANDATE_UNAVAILABLE");
  }
  return { body: parsed.body, canonical, signature: decodeSignature(parsed.signature) };
}

function safeDto(row: typeof mandates.$inferSelect): MandateDto {
  return {
    id: row.id,
    agentDid: row.agentDid,
    kind: row.kind,
    status: row.status,
    currency: "HKD",
    maxAmountCents: row.maxAmountCents,
    merchant: row.merchant,
    mccAllowlist: [...row.mccAllowlist],
    parentMandateId: row.parentMandateId,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    oneTime: row.oneTime,
    bodyDigest: row.bodyDigest.toString("base64url"),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    consumedAt: row.consumedAt?.toISOString() ?? null,
  };
}

async function lockAgentForUser(transaction: Transaction, agentId: string): Promise<void> {
  await transaction.execute(sql`select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.agent:' || ${agentId}::text, 0)
  )`);
}
async function databaseTime(transaction: Transaction): Promise<Date> {
  const result = await transaction.execute(sql`select clock_timestamp() as current_time`);
  const value = (result.rows[0] as { current_time?: Date | string } | undefined)?.current_time;
  if (!value) throw new MandateServiceError("MANDATE_UNAVAILABLE");
  return date(value);
}

async function lockAndClaim(transaction: Transaction, context: AuthContext): Promise<void> {
  await transaction.execute(sql`
    select public.hermes_lock_gateway_signature_agent(
      ${context.agentId}::uuid,
      ${context.organizationId}::uuid,
      ${context.keyId}::uuid
    )
  `);
  await transaction.execute(sql`
    select public.hermes_set_signature_authenticated_agent_claim(
      ${context.agentId}::uuid,
      ${context.organizationId}::uuid,
      ${context.keyId}::uuid
    )
  `);
}

function exactReplay(
  row: typeof mandates.$inferSelect,
  bodyDigest: Buffer,
  signature: Buffer,
): boolean {
  return row.bodyDigest.equals(bodyDigest) && row.signature.equals(signature);
}

function parentIsValid(
  body: MandateBodyV1,
  parent: typeof mandates.$inferSelect | undefined,
  context: AuthContext,
  now: Date,
): boolean {
  if (body.kind === "intent") return body.parentMandateId === null;
  return Boolean(
    body.parentMandateId &&
    parent &&
    parent.agentId === context.agentId &&
    parent.organizationId === context.organizationId &&
    parent.kind === "intent" &&
    parent.status === "active" &&
    parent.expiresAt.getTime() > now.getTime(),
  );
}

async function issueInTransaction(
  transaction: Transaction,
  signed: SignedMandateV1,
  expectedOrganizationId?: string,
): Promise<MandateIssueResult> {
  const { body, canonical, signature } = assertSafeMandate(signed);
  const initial = await lookupAuthContext(transaction, body.agentDid, body.keyId);
  if (!initial || !lifecycleIsActive(initial, new Date())) {
    throw new MandateServiceError("AGENT_AUTH_FAILED");
  }

  if (expectedOrganizationId && initial.organizationId !== expectedOrganizationId) {
    throw new MandateServiceError("AGENT_AUTH_FAILED");
  }
  const verificationKey = { ...toMandateKey(initial), agentDid: body.agentDid };
  const firstVerification = verifyMandate(signed, verificationKey, new Date());
  if (!firstVerification.valid) throw new MandateServiceError("AGENT_AUTH_FAILED");

  // The advisory lock is acquired before nonce and parent reads, matching the
  // gateway signature-authenticated lifecycle ordering.
  await lockAndClaim(transaction, initial);
  const locked = await lookupAuthContext(transaction, body.agentDid, body.keyId);
  const now = await databaseTime(transaction);
  if (!locked || !lifecycleIsActive(locked, now)) {
    throw new MandateServiceError("AGENT_AUTH_FAILED");
  }
  const verification = verifyMandate(
    signed,
    {
      ...toMandateKey(locked),
      agentDid: body.agentDid,
    },
    now,
  );
  if (!verification.valid) throw new MandateServiceError("AGENT_AUTH_FAILED");

  const bodyDigest = digest(canonical);
  const existingRows = await transaction
    .select()
    .from(mandates)
    .where(and(eq(mandates.agentId, locked.agentId), eq(mandates.nonce, body.nonce)))
    .limit(1);
  const existing = existingRows[0];
  if (existing) {
    if (!exactReplay(existing, bodyDigest, signature)) {
      throw new MandateServiceError("NONCE_CONFLICT");
    }
    return { mandate: safeDto(existing), replayed: true };
  }

  let parent: typeof mandates.$inferSelect | undefined;
  if (body.parentMandateId) {
    parent = (
      await transaction
        .select()
        .from(mandates)
        .where(
          and(
            eq(mandates.id, body.parentMandateId),
            eq(mandates.agentId, locked.agentId),
            eq(mandates.organizationId, locked.organizationId),
          ),
        )
        .limit(1)
    )[0];
  }
  if (!parentIsValid(body, parent, locked, now)) {
    throw new MandateServiceError("MANDATE_PARENT_INVALID");
  }

  const issuedAt = date(body.issuedAt);
  const expiresAt = date(body.constraints.expiresAt);
  const rows = await transaction
    .insert(mandates)
    .values({
      id: body.mandateId,
      organizationId: locked.organizationId,
      agentId: locked.agentId,
      kind: body.kind,
      version: 1,
      nonce: body.nonce,
      agentDid: body.agentDid,
      keyId: locked.keyId,
      keyThumbprint: locked.thumbprint,
      body: body,
      signature,
      bodyDigest,
      currency: body.constraints.currency,
      maxAmountCents: body.constraints.maxAmountCents,
      mccAllowlist: body.constraints.mccAllowlist,
      merchant: body.constraints.merchant,
      parentMandateId: body.parentMandateId,
      status: "active",
      oneTime: body.constraints.oneTime,
      issuedAt,
      expiresAt,
    })
    .returning();
  const stored = rows[0];
  if (!stored) throw new MandateServiceError("MANDATE_UNAVAILABLE");

  await transaction.insert(agentAuditLogs).values({
    organizationId: locked.organizationId,
    agentId: locked.agentId,
    actorType: "agent",
    actorId: locked.agentId,
    action: "mandate.issued",
    summary: `Payment mandate issued${body.constraints.merchant ? ` for ${body.constraints.merchant.slice(0, 120)}` : ""}`,
    decision: "allow",
    tool: "payment.mandate",
    amountCents: body.constraints.maxAmountCents,
    payload: {
      mandateId: stored.id,
      nonce: body.nonce,
      bodyDigest: digestString(canonical),
      signatureDigest: digestString(signature),
      keyId: locked.keyId,
      keyThumbprint: locked.thumbprint,
      kind: body.kind,
      merchant: body.constraints.merchant?.slice(0, 120) ?? null,
      expiresAt: expiresAt.toISOString(),
    },
    occurredAt: now,
    hash: Buffer.alloc(32),
  });

  return { mandate: safeDto(stored), replayed: false };
}

export async function issueMandate(
  signed: SignedMandateV1,
  actor?: Actor,
  runner?: MandateTransactionRunner,
): Promise<MandateIssueResult> {
  if (actor) {
    assertCanMutate(actor);
    const run: MandateTransactionRunner =
      runner ?? ((callback) => withActorTransaction(actor, callback));
    return run(async (transaction) => {
      const result = await issueInTransaction(transaction, signed, actor.organizationId);
      if (result.mandate.id) return result;
      throw new MandateServiceError("MANDATE_UNAVAILABLE");
    });
  }
  const run: MandateTransactionRunner =
    runner ?? ((callback) => withPublicDatabase((database) => database.transaction(callback)));
  return run((transaction) => issueInTransaction(transaction, signed));
}

export async function listMandates(
  actor: Actor,
  runner?: MandateTransactionRunner,
): Promise<MandateDto[]> {
  const run: MandateTransactionRunner =
    runner ?? ((callback) => withActorTransaction(actor, callback));
  return run(async (transaction) => {
    const rows = await transaction
      .select()
      .from(mandates)
      .where(eq(mandates.organizationId, actor.organizationId))
      .orderBy(desc(mandates.createdAt));
    return rows.map(safeDto);
  });
}

export async function revokeMandate(
  actor: Actor,
  mandateId: string,
  runner?: MandateTransactionRunner,
): Promise<MandateDto> {
  assertCanMutate(actor);
  const parsedId = z.string().uuid().parse(mandateId);
  const run: MandateTransactionRunner =
    runner ?? ((callback) => withActorTransaction(actor, callback));
  return run(async (transaction) => {
    const rows = await transaction
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, parsedId), eq(mandates.organizationId, actor.organizationId)))
      .limit(1);
    const current = rows[0];
    if (!current) throw new MandateServiceError("MANDATE_NOT_FOUND");
    await lockAgentForUser(transaction, current.agentId);

    // Re-read after the shared agent lock. A concurrent revoke may have
    // changed the row while this transaction was waiting.
    const lockedRows = await transaction
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, parsedId), eq(mandates.organizationId, actor.organizationId)))
      .limit(1);
    const locked = lockedRows[0];
    if (!locked) throw new MandateServiceError("MANDATE_NOT_FOUND");
    if (locked.status !== "active") return safeDto(locked);

    const now = await databaseTime(transaction);
    const updated = await transaction
      .update(mandates)
      .set({ status: "revoked", revokedAt: now })
      .where(
        and(
          eq(mandates.id, parsedId),
          eq(mandates.organizationId, actor.organizationId),
          eq(mandates.status, "active"),
        ),
      )
      .returning();
    const revoked = updated[0];
    if (!revoked) {
      const afterRows = await transaction
        .select()
        .from(mandates)
        .where(and(eq(mandates.id, parsedId), eq(mandates.organizationId, actor.organizationId)))
        .limit(1);
      const after = afterRows[0];
      if (!after) throw new MandateServiceError("MANDATE_NOT_FOUND");
      return safeDto(after);
    }

    await transaction.insert(agentAuditLogs).values({
      organizationId: actor.organizationId,
      agentId: revoked.agentId,
      actorType: "user",
      actorId: actor.userId,
      action: "mandate.revoked",
      summary: "Payment mandate revoked",
      decision: "deny",
      tool: "payment.mandate",
      amountCents: revoked.maxAmountCents,
      payload: { mandateId: revoked.id, bodyDigest: revoked.bodyDigest.toString("base64url") },
      occurredAt: now,
      hash: Buffer.alloc(32),
    });
    return safeDto(revoked);
  });
}
