import type { PublicJwk } from "@/db/schema";

export function didWebForOrigin(origin: string): string {
  const url = new URL(origin);
  const host = url.host.replace(/:/g, "%3A");
  return `did:web:${host}`;
}

export function agentDidForOrigin(origin: string, slug: string): string {
  return `${didWebForOrigin(origin)}:agent:${encodeURIComponent(slug)}`;
}

export function issuerDidDocument(origin: string, publicJwk: PublicJwk, keyFragment = "issuer-1") {
  const did = didWebForOrigin(origin);
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [
      { id: `${did}#${keyFragment}`, type: "JsonWebKey", controller: did, publicKeyJwk: publicJwk },
    ],
    authentication: [`${did}#${keyFragment}`],
    assertionMethod: [`${did}#${keyFragment}`],
  };
}

export function agentDidDocument(
  origin: string,
  slug: string,
  publicJwk: PublicJwk,
  keyFragment = "agent-1",
) {
  const did = agentDidForOrigin(origin, slug);
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [
      { id: `${did}#${keyFragment}`, type: "JsonWebKey", controller: did, publicKeyJwk: publicJwk },
    ],
    authentication: [`${did}#${keyFragment}`],
    assertionMethod: [`${did}#${keyFragment}`],
  };
}

export function didWebDocumentPath(slug?: string): string {
  return slug ? `/agent/${encodeURIComponent(slug)}/did.json` : "/.well-known/did.json";
}
