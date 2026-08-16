import type { PublicJwk } from "@/db/schema";

export function didWebForOrigin(origin: string): string {
  const url = new URL(origin);
  const host = url.host.replace(/:/g, "%3A");
  return `did:web:${host}`;
}

export function agentDidForOrigin(origin: string, slug: string): string {
  return `${didWebForOrigin(origin)}:agent:${encodeURIComponent(slug)}`;
}

type IssuerVerificationKey = { keyFragment: string; publicJwk: PublicJwk; active?: boolean };

export function issuerDidDocument(
  origin: string,
  publicJwkOrKeys: PublicJwk | IssuerVerificationKey[],
  keyFragment = "issuer-1",
) {
  const did = didWebForOrigin(origin);
  const keys = Array.isArray(publicJwkOrKeys)
    ? publicJwkOrKeys
    : [{ keyFragment, publicJwk: publicJwkOrKeys }];
  const activeMethodIds = keys
    .filter((key) => key.active !== false)
    .map((key) => `${did}#${key.keyFragment}`);
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: keys.map((key) => ({
      id: `${did}#${key.keyFragment}`,
      type: "JsonWebKey",
      controller: did,
      publicKeyJwk: key.publicJwk,
    })),
    authentication: activeMethodIds,
    assertionMethod: activeMethodIds,
  };
}

export function agentDidDocument(
  origin: string,
  slug: string,
  publicJwk: PublicJwk,
  keyFragment = "agent-1",
  active = true,
) {
  const did = agentDidForOrigin(origin, slug);
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [
      { id: `${did}#${keyFragment}`, type: "JsonWebKey", controller: did, publicKeyJwk: publicJwk },
    ],
    authentication: active ? [`${did}#${keyFragment}`] : [],
    assertionMethod: active ? [`${did}#${keyFragment}`] : [],
  };
}

export function didWebDocumentPath(slug?: string): string {
  return slug ? `/agent/${encodeURIComponent(slug)}/did.json` : "/.well-known/did.json";
}
