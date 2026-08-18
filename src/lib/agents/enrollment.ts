import { createHash, randomBytes, webcrypto } from "node:crypto";
import canonicalize from "canonicalize";
import { sql } from "drizzle-orm";
import { calculateJwkThumbprint } from "jose";

import { agentAuditLogs, type PublicJwk } from "@/db/schema";
import type { Actor } from "@/lib/auth/authorization";
import { withPublicDatabase } from "@/lib/db";

const ENROLLMENT_PURPOSE = "hermespass-agent-key-enrollment";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const cryptoApi = globalThis.crypto ?? webcrypto;

type PublicEd25519Jwk = PublicJwk & {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
};

export type EnrollmentProofInput = {
  token: unknown;
  publicJwk: unknown;
  proof: unknown;
};

export type VerifiedEnrollmentProof = {
  tokenHash: Buffer;
  publicJwk: PublicEd25519Jwk;
  proof: string;
  thumbprint: string;
  keyFragment: string;
};

function invalidEnrollment(): Error {
  return new Error("AGENT_ENROLLMENT_INVALID");
}

function decodeExactBase64Url(value: unknown, pattern: RegExp, expectedBytes: number): Buffer {
  if (typeof value !== "string" || !pattern.test(value)) throw invalidEnrollment();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    throw invalidEnrollment();
  }
  return decoded;
}

export function generateEnrollmentToken(): {
  token: string;
  tokenHash: Buffer;
} {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token, "utf8").digest(),
  };
}

export function validatePublicEd25519Jwk(value: unknown): PublicEd25519Jwk {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.prototype.hasOwnProperty.call(value, "d")
  ) {
    throw invalidEnrollment();
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate["kty"] !== "OKP" ||
    candidate["crv"] !== "Ed25519" ||
    typeof candidate["x"] !== "string"
  ) {
    throw invalidEnrollment();
  }
  decodeExactBase64Url(candidate["x"], PUBLIC_KEY_PATTERN, 32);
  return value as PublicEd25519Jwk;
}

export function buildEnrollmentProofMessage(token: string, value: unknown): ArrayBuffer {
  decodeExactBase64Url(token, TOKEN_PATTERN, 32);
  const publicJwk = validatePublicEd25519Jwk(value);
  const message = canonicalize({
    version: "1",
    purpose: ENROLLMENT_PURPOSE,
    token,
    publicJwk,
  });
  if (!message) throw invalidEnrollment();
  return new TextEncoder().encode(message).buffer as ArrayBuffer;
}

export async function verifyEnrollmentProof(
  input: EnrollmentProofInput,
): Promise<VerifiedEnrollmentProof> {
  try {
    const token = typeof input.token === "string" ? input.token : "";
    decodeExactBase64Url(token, TOKEN_PATTERN, 32);
    const publicJwk = validatePublicEd25519Jwk(input.publicJwk);
    const signature = decodeExactBase64Url(input.proof, SIGNATURE_PATTERN, 64);
    const publicKey = await cryptoApi.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const verified = await cryptoApi.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      Uint8Array.from(signature).buffer,
      buildEnrollmentProofMessage(token, publicJwk),
    );
    if (!verified) throw invalidEnrollment();

    const thumbprint = await calculateJwkThumbprint(publicJwk, "sha256");
    return {
      tokenHash: createHash("sha256").update(token, "utf8").digest(),
      publicJwk,
      proof: input.proof as string,
      thumbprint,
      keyFragment: `key-${thumbprint}`,
    };
  } catch {
    throw invalidEnrollment();
  }
}

type DatabaseError = {
  code?: unknown;
};

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as DatabaseError).code;
  return typeof code === "string" ? code : "";
}

export async function createAgentKeyEnrollment(
  actor: Actor,
  agentId: string,
): Promise<{ token: string; expiresAt: string }> {
  const { assertCanMutate, withActorTransaction } = await import("@/lib/auth/authorization");
  assertCanMutate(actor);
  const generated = generateEnrollmentToken();

  try {
    return await withActorTransaction(actor, async (tx) => {
      const result = await tx.execute(sql`
        select enrollment_id, expires_at
        from hermes_create_agent_key_enrollment(
          ${actor.organizationId}::uuid,
          ${agentId}::uuid,
          ${generated.tokenHash}::bytea
        )
      `);
      const row = result.rows[0] as
        { enrollment_id: string; expires_at: Date | string } | undefined;
      if (!row) throw new Error("ENROLLMENT_UNAVAILABLE");

      await tx.insert(agentAuditLogs).values({
        organizationId: actor.organizationId,
        agentId,
        actorType: "user",
        actorId: actor.userId,
        action: "agent.key.enrollment.created",
        summary: "Agent key enrollment token created",
        decision: "allow",
        tool: "agent.key.enrollment",
        payload: { expiresAt: new Date(row.expires_at).toISOString() },
        hash: Buffer.alloc(32),
      });

      return {
        token: generated.token,
        expiresAt: new Date(row.expires_at).toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ENROLLMENT_UNAVAILABLE") throw error;
    if (errorCode(error) === "42501") throw new Error("AGENT_NOT_ENROLLABLE");
    throw new Error("ENROLLMENT_UNAVAILABLE");
  }
}

export async function consumeAgentKeyEnrollment(input: EnrollmentProofInput): Promise<{
  agentId: string;
  keyId: string;
  keyFragment: string;
  thumbprint: string;
}> {
  const verified = await verifyEnrollmentProof(input);

  try {
    return await withPublicDatabase((db) =>
      db.transaction(async (tx) => {
        const result = await tx.execute(sql`
          select agent_id, organization_id, key_id
          from hermes_consume_agent_key_enrollment(
            ${verified.tokenHash}::bytea,
            ${verified.keyFragment},
            ${JSON.stringify(verified.publicJwk)}::jsonb,
            ${verified.thumbprint}
          )
        `);
        const row = result.rows[0] as
          { agent_id: string; organization_id: string; key_id: string } | undefined;
        if (!row) throw invalidEnrollment();

        await tx.execute(sql`
          select hermes_set_verified_agent_claim(
            ${row.agent_id}::uuid,
            ${row.organization_id}::uuid,
            ${row.key_id}::uuid
          )
        `);
        await tx.insert(agentAuditLogs).values({
          organizationId: row.organization_id,
          agentId: row.agent_id,
          actorType: "agent",
          actorId: row.agent_id,
          action: "agent.key.enrolled",
          summary: "External agent public key enrolled",
          decision: "allow",
          tool: "agent.key.enrollment",
          payload: {
            keyId: row.key_id,
            keyFragment: verified.keyFragment,
            thumbprint: verified.thumbprint,
            custody: "external",
          },
          hash: Buffer.alloc(32),
        });

        return {
          agentId: row.agent_id,
          keyId: row.key_id,
          keyFragment: verified.keyFragment,
          thumbprint: verified.thumbprint,
        };
      }),
    );
  } catch (error) {
    if (errorCode(error) === "P0002") throw invalidEnrollment();
    if (
      error instanceof Error &&
      error.message === "DATABASE_URL is required for database-backed requests"
    ) {
      throw error;
    }
    throw new Error("ENROLLMENT_UNAVAILABLE");
  }
}
