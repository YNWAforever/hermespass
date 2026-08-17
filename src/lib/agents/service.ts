import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  agentAuditLogs,
  agentKeys,
  agents,
  issuerKeys,
  organizations,
  type AgentRow,
  type PublicJwk,
} from "@/db/schema";
import { decryptPrivateJwk, encryptPrivateJwk, buildAad } from "@/lib/crypto/envelope";
import { hermesKek, issuerOrigin, keyEnvironment } from "@/lib/env";
import { withPublicDatabase } from "@/lib/db";
import { agentDidForOrigin, didWebForOrigin } from "@/lib/identity/did";
import { generateEd25519KeyPair } from "@/lib/identity/keys";
import {
  buildPassportCredential,
  CredentialTemporalError,
  oneCalendarYearLater,
  signPassportCredential,
  verifyPassportCredential,
} from "@/lib/identity/vc";
import { assertCanMutate, type Actor, withActorTransaction } from "@/lib/auth/authorization";
import { agentDto, type AgentDto } from "@/lib/agents/types";

export const issueAgentInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
    risk: z.enum(["low", "medium", "high"]),
    scopes: z
      .array(
        z.enum([
          "catalog.read",
          "crm.read",
          "refund.issue",
          "email.dispatch",
          "checkout.external",
          "invoice.approve",
          "ads.bid",
          "vendor.contract",
        ]),
      )
      .min(1)
      .max(8),
    spendCap: z
      .number()
      .finite()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER / 100)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100,
        "Spend cap must have at most two decimal places",
      ),
    governanceNotes: z.string().trim().max(4000).nullable().optional(),
  })
  .transform(({ spendCap, ...input }) => ({
    ...input,
    spendCapCents: Math.round(spendCap * 100),
  }));

export type IssueAgentInput = z.infer<typeof issueAgentInput>;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "agent"
  );
}

function dtoSelection() {
  return {
    row: agents,
    organizationName: organizations.name,
    organizationSlug: organizations.slug,
    publicJwk: agentKeys.publicJwk,
    keyThumbprint: agentKeys.thumbprint,
  };
}

type AgentQueryRow = {
  row: AgentRow;
  organizationName: string;
  organizationSlug: string;
  publicJwk: PublicJwk | null;
  keyThumbprint: string | null;
};

function mapRow(value: AgentQueryRow): AgentDto {
  return agentDto({
    ...value.row,
    organizationName: value.organizationName,
    organizationSlug: value.organizationSlug,
    publicJwk: value.publicJwk,
    thumbprint: value.keyThumbprint,
  });
}

export async function listAgents(actor: Actor): Promise<AgentDto[]> {
  return withActorTransaction(actor, async (tx) => {
    const rows = await tx
      .select(dtoSelection())
      .from(agents)
      .innerJoin(organizations, eq(agents.organizationId, organizations.id))
      .leftJoin(
        agentKeys,
        and(
          eq(agentKeys.agentId, agents.id),
          eq(agentKeys.organizationId, agents.organizationId),
          eq(agentKeys.status, "active"),
        ),
      )
      .where(eq(agents.organizationId, actor.organizationId))
      .orderBy(desc(agents.createdAt));
    return rows.map(mapRow);
  });
}

export async function issueAgent(actor: Actor, input: unknown): Promise<AgentDto> {
  assertCanMutate(actor);
  const parsed = issueAgentInput.parse(input);
  const now = new Date();
  const expiresAt = oneCalendarYearLater(now);
  const agentId = randomUUID();
  const keyId = randomUUID();
  const origin = issuerOrigin();
  const issuerDid = didWebForOrigin(origin);
  const slugBase = slugify(parsed.name);
  const slug = `${slugBase}-${agentId.slice(0, 8)}`;
  const did = agentDidForOrigin(origin, slug);
  const credentialId = `urn:uuid:${randomUUID()}`;
  const agentPair = await generateEd25519KeyPair();
  const kek = hermesKek();
  const environment = keyEnvironment();

  return withActorTransaction(actor, async (tx) => {
    const issuer = await tx
      .select()
      .from(issuerKeys)
      .where(and(eq(issuerKeys.did, issuerDid), eq(issuerKeys.status, "active")))
      .orderBy(desc(issuerKeys.createdAt))
      .limit(1);
    const issuerRow = issuer[0];
    if (!issuerRow) throw new Error("ISSUER_NOT_CONFIGURED");

    const issuerPrivateJwk = await decryptPrivateJwk(
      {
        ciphertext: new Uint8Array(issuerRow.ciphertext),
        iv: new Uint8Array(issuerRow.iv),
        wrappedDek: new Uint8Array(issuerRow.wrappedDek),
        kekVersion: issuerRow.kekVersion as "v1",
        algorithm: issuerRow.encryptionAlgorithm as "A256GCM+A256KW",
      },
      kek,
      buildAad({
        environment,
        purpose: "issuer-signing",
        tenant: "platform",
        entity: "issuer",
        keyId: issuerRow.keyFragment,
      }),
    );
    const encryptedAgentKey = await encryptPrivateJwk(
      agentPair.privateJwk,
      kek,
      buildAad({
        environment,
        purpose: "agent-control",
        tenant: actor.organizationId,
        entity: agentId,
        keyId,
      }),
    );
    const credential = buildPassportCredential({
      id: credentialId,
      issuer: issuerDid,
      issuedAt: now,
      expiresAt,
      subject: {
        id: did,
        name: parsed.name,
        role: parsed.role,
        ownerOrganization: actor.organizationName,
        ownerOrganizationSlug: actor.organizationSlug,
        riskTier: parsed.risk,
        capabilities: parsed.scopes,
        spendCapHKD: parsed.spendCapCents / 100,
      },
    });
    const credentialJws = await signPassportCredential(
      credential,
      issuerPrivateJwk,
      `${issuerDid}#${issuerRow.keyFragment}`,
    );

    await tx.insert(agents).values({
      id: agentId,
      organizationId: actor.organizationId,
      slug,
      did,
      name: parsed.name,
      role: parsed.role,
      risk: parsed.risk,
      scopes: parsed.scopes,
      spendCapCents: parsed.spendCapCents,
      governanceNotes: parsed.governanceNotes ?? null,
      status: "active",
      credentialId,
      credentialJws,
      issuedAt: now,
      expiresAt,
      createdBy: actor.userId,
    });
    await tx.insert(agentKeys).values({
      id: keyId,
      agentId,
      organizationId: actor.organizationId,
      keyFragment: "agent-1",
      publicJwk: agentPair.publicJwk as PublicJwk,
      thumbprint: agentPair.thumbprint,
      ciphertext: Buffer.from(encryptedAgentKey.ciphertext),
      iv: Buffer.from(encryptedAgentKey.iv),
      wrappedDek: Buffer.from(encryptedAgentKey.wrappedDek),
      kekVersion: encryptedAgentKey.kekVersion,
      encryptionAlgorithm: encryptedAgentKey.algorithm,
      status: "active",
    });
    await tx.insert(agentAuditLogs).values({
      organizationId: actor.organizationId,
      agentId,
      actorType: "user",
      actorId: actor.userId,
      action: "passport.issued",
      summary: `Passport issued for ${parsed.name}`,
      decision: "allow",
      tool: "passport.issue",
      payload: { did, scopes: parsed.scopes, risk: parsed.risk, credentialId },
      hash: Buffer.alloc(32),
    });

    const rows = await tx
      .select(dtoSelection())
      .from(agents)
      .innerJoin(organizations, eq(agents.organizationId, organizations.id))
      .leftJoin(
        agentKeys,
        and(
          eq(agentKeys.agentId, agents.id),
          eq(agentKeys.organizationId, agents.organizationId),
          eq(agentKeys.status, "active"),
        ),
      )
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!rows[0]) throw new Error("ISSUANCE_READBACK_FAILED");
    return mapRow(rows[0]);
  });
}

export async function revokeAgent(actor: Actor, agentId: string): Promise<AgentDto> {
  assertCanMutate(actor);
  return withActorTransaction(actor, async (tx) => {
    await tx.execute(
      sql`select changed from hermes_revoke_agent(${agentId}::uuid, ${actor.organizationId}::uuid, ${actor.userId})`,
    );
    const rows = await tx
      .select(dtoSelection())
      .from(agents)
      .innerJoin(organizations, eq(agents.organizationId, organizations.id))
      .leftJoin(
        agentKeys,
        and(
          eq(agentKeys.agentId, agents.id),
          eq(agentKeys.organizationId, agents.organizationId),
          eq(agentKeys.status, "active"),
        ),
      )
      .where(and(eq(agents.id, agentId), eq(agents.organizationId, actor.organizationId)))
      .limit(1);
    const current = rows[0];
    if (!current) throw new Error("AGENT_NOT_FOUND");
    return mapRow(current);
  });
}

type PublicAgentRow = {
  id: string;
  slug: string;
  did: string;
  name: string;
  role: string;
  organization_name: string;
  organization_slug: string;
  risk: "low" | "medium" | "high";
  scopes: string[];
  spend_cap_cents: number;
  status: "active" | "revoked";
  credential_id: string;
  credential_jws: string;
  issued_at: Date;
  expires_at: Date;
  public_jwk: JsonWebKey | null;
  thumbprint: string | null;
};

export async function getPublicAgent(slug: string): Promise<PublicAgentRow | null> {
  return withPublicDatabase(async (db) => {
    const result = await db.execute(sql`select * from hermes_public_agent(${slug})`);
    return (result.rows[0] as PublicAgentRow | undefined) ?? null;
  });
}

export async function getPublicIssuerKey(did: string, keyFragment?: string) {
  return withPublicDatabase(async (db) => {
    const result = keyFragment
      ? await db.execute(
          sql`select * from hermes_public_issuer_key_for_fragment(${did}, ${keyFragment})`,
        )
      : await db.execute(sql`select * from hermes_public_issuer_key(${did})`);
    return (
      (result.rows[0] as
        | { did: string; key_fragment: string; public_jwk: JsonWebKey; thumbprint: string }
        | undefined) ?? null
    );
  });
}

export async function getPublicIssuerKeys(did: string) {
  return withPublicDatabase(async (db) => {
    const result = await db.execute(sql`select * from hermes_public_issuer_keys(${did})`);
    return result.rows as Array<{
      did: string;
      key_fragment: string;
      public_jwk: JsonWebKey;
      thumbprint: string;
      active: boolean;
    }>;
  });
}

function credentialKeyFragment(jws: string): string | undefined {
  try {
    const encoded = jws.split(".")[0];
    if (!encoded) return undefined;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const header = JSON.parse(
      Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString(
        "utf8",
      ),
    ) as { kid?: unknown };
    return typeof header.kid === "string" && header.kid.includes("#")
      ? header.kid.split("#").pop()
      : undefined;
  } catch {
    return undefined;
  }
}

export async function getPublicAgentByDid(did: string): Promise<PublicAgentRow | null> {
  return withPublicDatabase(async (db) => {
    const result = await db.execute(sql`select * from hermes_public_agent_by_did(${did})`);
    return (result.rows[0] as PublicAgentRow | undefined) ?? null;
  });
}

export async function verifyPublicAgent(slug: string) {
  const agent = await getPublicAgent(slug);
  if (!agent) return null;
  const issuerDid = didWebForOrigin(issuerOrigin());
  const issuer = await getPublicIssuerKey(issuerDid, credentialKeyFragment(agent.credential_jws));
  if (!issuer) return { valid: false, status: "issuer_unavailable", did: agent.did };

  try {
    const verified = await verifyPassportCredential(
      agent.credential_jws,
      issuer.public_jwk,
      `${issuer.did}#${issuer.key_fragment}`,
      {
        credentialId: agent.credential_id,
        issuerDid: issuer.did,
        subjectDid: agent.did,
        name: agent.name,
        role: agent.role,
        organizationName: agent.organization_name,
        organizationSlug: agent.organization_slug,
        risk: agent.risk,
        scopes: agent.scopes,
        spendCapCents: Number(agent.spend_cap_cents),
        issuedAt: new Date(agent.issued_at),
        expiresAt: new Date(agent.expires_at),
      },
    );
    const now = Date.now();
    const expired = new Date(verified.credential.validUntil).getTime() <= now;
    const status = expired ? "expired" : agent.status;
    return {
      valid: !expired && agent.status === "active",
      status,
      did: agent.did,
      credentialId: agent.credential_id,
      issuer: verified.credential.issuer,
      credential: verified.credential,
      checks: { signature: true, issuer: true, expiry: !expired, storedStatus: agent.status },
    };
  } catch (error) {
    if (error instanceof CredentialTemporalError) {
      return {
        valid: false,
        status: error.reason,
        did: agent.did,
        credentialId: agent.credential_id,
        issuer: error.credential.issuer,
        credential: error.credential,
        checks: { signature: true, issuer: true, expiry: false, storedStatus: agent.status },
      };
    }
    return { valid: false, status: "invalid", did: agent.did, checks: { signature: false } };
  }
}

export async function verifyPublicAgentByDid(did: string) {
  const agent = await getPublicAgentByDid(did);
  if (!agent) return null;
  const issuerDid = didWebForOrigin(issuerOrigin());
  const issuer = await getPublicIssuerKey(issuerDid, credentialKeyFragment(agent.credential_jws));
  if (!issuer) return { valid: false, status: "issuer_unavailable", did: agent.did };
  try {
    const verified = await verifyPassportCredential(
      agent.credential_jws,
      issuer.public_jwk,
      `${issuer.did}#${issuer.key_fragment}`,
      {
        credentialId: agent.credential_id,
        issuerDid: issuer.did,
        subjectDid: agent.did,
        name: agent.name,
        role: agent.role,
        organizationName: agent.organization_name,
        organizationSlug: agent.organization_slug,
        risk: agent.risk,
        scopes: agent.scopes,
        spendCapCents: Number(agent.spend_cap_cents),
        issuedAt: new Date(agent.issued_at),
        expiresAt: new Date(agent.expires_at),
      },
    );
    const expired = new Date(verified.credential.validUntil).getTime() <= Date.now();
    const status = expired ? "expired" : agent.status;
    return {
      valid: !expired && agent.status === "active",
      status,
      did: agent.did,
      credentialId: agent.credential_id,
      issuer: verified.credential.issuer,
      credential: verified.credential,
      checks: { signature: true, issuer: true, expiry: !expired, storedStatus: agent.status },
    };
  } catch (error) {
    if (error instanceof CredentialTemporalError) {
      return {
        valid: false,
        status: error.reason,
        did: agent.did,
        credentialId: agent.credential_id,
        issuer: error.credential.issuer,
        credential: error.credential,
        checks: { signature: true, issuer: true, expiry: false, storedStatus: agent.status },
      };
    }
    return { valid: false, status: "invalid", did: agent.did, checks: { signature: false } };
  }
}
