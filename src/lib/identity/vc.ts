import { CompactSign, compactVerify, importJWK } from "jose";
import { TextEncoder } from "node:util";
import { z } from "zod";

export const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";
export const HERMES_CONTEXT = "https://hermespass.asia/contexts/kya-agent-passport-v1";

export type PassportSubject = {
  id: string;
  name: string;
  role: string;
  ownerOrganization: string;
  ownerOrganizationSlug: string;
  riskTier: "low" | "medium" | "high";
  capabilities: string[];
  spendCapHKD: number;
};

export type PassportCredential = {
  "@context": string[];
  id: string;
  type: ["VerifiableCredential", "KyaAgentPassport"];
  issuer: string;
  validFrom: string;
  validUntil: string;
  credentialSubject: PassportSubject;
};

const isoTimestamp = z.string().datetime({ offset: true });
const passportSubjectSchema = z
  .object({
    id: z.string().startsWith("did:web:"),
    name: z.string().min(1).max(120),
    role: z.string().min(1).max(120),
    ownerOrganization: z.string().min(1),
    ownerOrganizationSlug: z.string().min(1),
    riskTier: z.enum(["low", "medium", "high"]),
    capabilities: z.array(z.string()).min(1),
    spendCapHKD: z.number().finite().nonnegative(),
  })
  .strict();
const passportCredentialSchema = z
  .object({
    "@context": z.tuple([z.literal(VC_CONTEXT), z.literal(HERMES_CONTEXT)]),
    id: z
      .string()
      .regex(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    type: z.tuple([z.literal("VerifiableCredential"), z.literal("KyaAgentPassport")]),
    issuer: z.string().startsWith("did:web:"),
    validFrom: isoTimestamp,
    validUntil: isoTimestamp,
    credentialSubject: passportSubjectSchema,
  })
  .strict();

export type PassportCredentialExpectation = {
  credentialId: string;
  issuerDid: string;
  subjectDid: string;
  name: string;
  role: string;
  organizationName: string;
  organizationSlug: string;
  risk: "low" | "medium" | "high";
  scopes: string[];
  spendCapCents: number;
  issuedAt: Date;
  expiresAt: Date;
  now?: Date;
};

export class CredentialTemporalError extends Error {
  constructor(
    public readonly reason: "not_yet_valid" | "expired",
    public readonly credential: PassportCredential,
  ) {
    super(reason === "expired" ? "Credential has expired" : "Credential is not yet valid");
    this.name = "CredentialTemporalError";
  }
}

export function oneCalendarYearLater(date: Date): Date {
  const result = new Date(date);
  const month = result.getUTCMonth();
  const day = result.getUTCDate();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (month === 1 && day === 29 && result.getUTCMonth() !== 1) {
    result.setUTCMonth(1, 28);
  }
  return result;
}

export function buildPassportCredential(input: {
  id: string;
  issuer: string;
  subject: PassportSubject;
  issuedAt: Date;
  expiresAt: Date;
}): PassportCredential {
  return {
    "@context": [VC_CONTEXT, HERMES_CONTEXT],
    id: input.id,
    type: ["VerifiableCredential", "KyaAgentPassport"],
    issuer: input.issuer,
    validFrom: input.issuedAt.toISOString(),
    validUntil: input.expiresAt.toISOString(),
    credentialSubject: input.subject,
  };
}

export async function signPassportCredential(
  credential: PassportCredential,
  privateJwk: JsonWebKey,
  kid: string,
): Promise<string> {
  const key = await importJWK(privateJwk, "EdDSA");
  return new CompactSign(Uint8Array.from(new TextEncoder().encode(JSON.stringify(credential))))
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "vc+jwt", cty: "vc" })
    .sign(key);
}

export async function verifyPassportCredential(
  jws: string,
  publicJwk: JsonWebKey,
  expectedKid?: string,
  expected?: PassportCredentialExpectation,
) {
  const key = await importJWK(publicJwk, "EdDSA");
  const result = await compactVerify(jws, key);
  const header = result.protectedHeader;
  if (header.alg !== "EdDSA" || header.typ !== "vc+jwt" || header.cty !== "vc") {
    throw new Error("Unsupported credential proof header");
  }
  if (expectedKid && header.kid !== expectedKid)
    throw new Error("Credential key ID does not match issuer");
  const payload = JSON.parse(new TextDecoder().decode(result.payload)) as unknown;
  const credential = passportCredentialSchema.parse(payload) as PassportCredential;
  if (!header.kid?.startsWith(`${credential.issuer}#`)) {
    throw new Error("Credential proof issuer does not match credential issuer");
  }

  if (expected) {
    const subject = credential.credentialSubject;
    const exactClaims =
      credential.id === expected.credentialId &&
      credential.issuer === expected.issuerDid &&
      credential.validFrom === expected.issuedAt.toISOString() &&
      credential.validUntil === expected.expiresAt.toISOString() &&
      subject.id === expected.subjectDid &&
      subject.name === expected.name &&
      subject.role === expected.role &&
      subject.ownerOrganization === expected.organizationName &&
      subject.ownerOrganizationSlug === expected.organizationSlug &&
      subject.riskTier === expected.risk &&
      subject.spendCapHKD === expected.spendCapCents / 100 &&
      subject.capabilities.length === expected.scopes.length &&
      subject.capabilities.every((scope, index) => scope === expected.scopes[index]);
    if (!exactClaims) throw new Error("Credential claims do not match the stored agent");
  }

  const validFrom = new Date(credential.validFrom).getTime();
  const validUntil = new Date(credential.validUntil).getTime();
  const now = (expected?.now ?? new Date()).getTime();
  if (validUntil <= validFrom) throw new Error("Credential validity interval is invalid");
  if (validFrom > now) throw new CredentialTemporalError("not_yet_valid", credential);
  if (validUntil <= now) throw new CredentialTemporalError("expired", credential);

  return {
    header,
    credential,
  };
}
