import type { AgentRow, PublicJwk } from "@/db/schema";

export type AgentDto = {
  databaseId: string;
  id: string;
  slug: string;
  name: string;
  role: string;
  org: string;
  orgSlug: string;
  status: "active" | "revoked";
  risk: "low" | "medium" | "high";
  scopes: string[];
  spendCap: number;
  issued: string;
  expires: string;
  keyStatus: "active" | "enrollment_required";
  keyCustody: "legacy_encrypted" | "external" | null;
  thumbprint: string | null;
  publicKey: string | null;
  credentialId: string;
  credentialJws: string;
  governanceNotes: string | null;
};

export type AgentPublicDto = Omit<AgentDto, "governanceNotes">;

export function agentDto(
  row: AgentRow & {
    organizationName: string;
    organizationSlug: string;
    publicJwk: PublicJwk | null;
    thumbprint: string | null;
    custody: "legacy_encrypted" | "external" | null;
  },
): AgentDto {
  return {
    databaseId: row.id,
    id: row.did,
    slug: row.slug,
    name: row.name,
    role: row.role,
    org: row.organizationName,
    orgSlug: row.organizationSlug,
    status: row.status,
    risk: row.risk,
    scopes: row.scopes,
    spendCap: row.spendCapCents / 100,
    issued: row.issuedAt.toISOString().slice(0, 10),
    expires: row.expiresAt.toISOString().slice(0, 10),
    keyStatus: row.publicJwk && row.thumbprint ? "active" : "enrollment_required",
    keyCustody: row.custody,
    thumbprint: row.thumbprint,
    publicKey: row.publicJwk?.x ? `Ed25519:${row.publicJwk.x}` : null,
    credentialId: row.credentialId,
    credentialJws: row.credentialJws,
    governanceNotes: row.governanceNotes,
  };
}

export function publicAgentDto(value: AgentDto): AgentPublicDto {
  const { governanceNotes, ...safe } = value;
  void governanceNotes;
  return safe;
}
