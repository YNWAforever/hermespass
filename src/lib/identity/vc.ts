import { CompactSign, compactVerify, importJWK } from "jose";
import { TextEncoder } from "node:util";

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
) {
  const key = await importJWK(publicJwk, "EdDSA");
  const result = await compactVerify(jws, key);
  const header = result.protectedHeader;
  if (header.alg !== "EdDSA" || header.typ !== "vc+jwt" || header.cty !== "vc") {
    throw new Error("Unsupported credential proof header");
  }
  if (expectedKid && header.kid !== expectedKid)
    throw new Error("Credential key ID does not match issuer");
  return {
    header,
    credential: JSON.parse(new TextDecoder().decode(result.payload)) as PassportCredential,
  };
}
