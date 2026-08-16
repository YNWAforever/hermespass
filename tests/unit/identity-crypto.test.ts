import { describe, expect, it, vi } from "vitest";
import { CompactSign, importJWK } from "jose";
import { TextEncoder } from "node:util";

import { buildAad, decryptPrivateJwk, encryptPrivateJwk } from "@/lib/crypto/envelope";
import { generateEd25519KeyPair } from "@/lib/identity/keys";
import {
  agentDidDocument,
  agentDidForOrigin,
  didWebForOrigin,
  issuerDidDocument,
} from "@/lib/identity/did";
import {
  buildPassportCredential,
  oneCalendarYearLater,
  signPassportCredential,
  verifyPassportCredential,
} from "@/lib/identity/vc";
import { issueAgentInput } from "@/lib/agents/service";

vi.mock("@/lib/auth/authorization", () => ({
  assertCanMutate: vi.fn(),
  withActorTransaction: vi.fn(),
}));

const expectedCredential = {
  credentialId: "urn:uuid:11111111-1111-4111-8111-111111111111",
  issuerDid: "did:web:hermespass.asia",
  subjectDid: "did:web:hermespass.asia:agent:test-agent",
  name: "Test Agent",
  role: "Support",
  organizationName: "Hermes Holdings APAC",
  organizationSlug: "hermes-holdings-apac",
  risk: "low" as const,
  scopes: ["catalog.read"],
  spendCapCents: 0,
  issuedAt: new Date("2026-01-01T00:00:00.000Z"),
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  now: new Date("2026-06-01T00:00:00.000Z"),
};

type BoundVerifier = (
  jws: string,
  publicJwk: JsonWebKey,
  expectedKid: string,
  expected: typeof expectedCredential,
) => ReturnType<typeof verifyPassportCredential>;

const verifyBoundCredential = verifyPassportCredential as unknown as BoundVerifier;

async function signPayload(payload: unknown, privateJwk: JsonWebKey) {
  const key = await importJWK(privateJwk, "EdDSA");
  return new CompactSign(Uint8Array.from(new TextEncoder().encode(JSON.stringify(payload))))
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "did:web:hermespass.asia#issuer-1",
      typ: "vc+jwt",
      cty: "vc",
    })
    .sign(key);
}

function passport(overrides: Record<string, unknown> = {}) {
  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://hermespass.asia/contexts/kya-agent-passport-v1",
    ],
    id: "urn:uuid:11111111-1111-4111-8111-111111111111",
    type: ["VerifiableCredential", "KyaAgentPassport"],
    issuer: "did:web:hermespass.asia",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    credentialSubject: {
      id: "did:web:hermespass.asia:agent:test-agent",
      name: "Test Agent",
      role: "Support",
      ownerOrganization: "Hermes Holdings APAC",
      ownerOrganizationSlug: "hermes-holdings-apac",
      riskTier: "low",
      capabilities: ["catalog.read"],
      spendCapHKD: 0,
    },
    ...overrides,
  };
}

describe("identity cryptography", () => {
  it("round-trips an encrypted private JWK and rejects changed AAD", async () => {
    const pair = await generateEd25519KeyPair();
    const kek = new Uint8Array(32).fill(7);
    const aad = buildAad({
      environment: "development",
      purpose: "agent-control",
      tenant: "org-1",
      entity: "agent-1",
      keyId: "key-1",
    });
    const encrypted = await encryptPrivateJwk(pair.privateJwk, kek, aad);
    await expect(decryptPrivateJwk(encrypted, kek, aad)).resolves.toMatchObject({
      d: pair.privateJwk.d,
    });
    await expect(
      decryptPrivateJwk(
        encrypted,
        kek,
        buildAad({
          environment: "production",
          purpose: "agent-control",
          tenant: "org-1",
          entity: "agent-1",
          keyId: "key-1",
        }),
      ),
    ).rejects.toThrow();
    await expect(decryptPrivateJwk(encrypted, new Uint8Array(32).fill(8), aad)).rejects.toThrow();
    const tampered = { ...encrypted, ciphertext: new Uint8Array(encrypted.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1;
    await expect(decryptPrivateJwk(tampered, kek, aad)).rejects.toThrow();
  });

  it("signs and verifies a VC 2.0 JOSE credential", async () => {
    const pair = await generateEd25519KeyPair();
    const issuedAt = new Date("2026-02-28T00:00:00.000Z");
    const credential = buildPassportCredential({
      id: "urn:uuid:11111111-1111-4111-8111-111111111111",
      issuer: "did:web:hermespass.asia",
      issuedAt,
      expiresAt: oneCalendarYearLater(issuedAt),
      subject: {
        id: "did:web:hermespass.asia:agent:test-agent",
        name: "Test Agent",
        role: "Support",
        ownerOrganization: "Hermes Holdings APAC",
        ownerOrganizationSlug: "hermes-holdings-apac",
        riskTier: "low",
        capabilities: ["catalog.read"],
        spendCapHKD: 0,
      },
    });
    const jws = await signPassportCredential(
      credential,
      pair.privateJwk,
      "did:web:hermespass.asia#issuer-1",
    );
    await expect(
      verifyPassportCredential(jws, pair.publicJwk, "did:web:hermespass.asia#issuer-1"),
    ).resolves.toMatchObject({
      credential,
      header: { alg: "EdDSA", typ: "vc+jwt", cty: "vc", kid: "did:web:hermespass.asia#issuer-1" },
    });
  });

  it("maps did:web origins and preserves agent slug paths", () => {
    expect(didWebForOrigin("https://hermespass.asia")).toBe("did:web:hermespass.asia");
    expect(agentDidForOrigin("https://preview.example.com", "test-agent")).toBe(
      "did:web:preview.example.com:agent:test-agent",
    );
    expect(
      agentDidDocument("https://preview.example.com", "test-agent", {
        kty: "OKP",
        crv: "Ed25519",
        x: "abc",
      }),
    ).toMatchObject({ id: "did:web:preview.example.com:agent:test-agent" });
  });

  it("clamps leap-day expiry to the last day of February", () => {
    expect(oneCalendarYearLater(new Date("2028-02-29T12:00:00.000Z")).toISOString()).toBe(
      "2029-02-28T12:00:00.000Z",
    );
  });

  it("publishes historical issuer verification methods alongside the active key", () => {
    const buildDocument = issuerDidDocument as unknown as (
      origin: string,
      keys: Array<{ keyFragment: string; publicJwk: JsonWebKey; active: boolean }>,
    ) => {
      assertionMethod: string[];
      authentication: string[];
      verificationMethod: Array<{ id: string }>;
    };

    const document = buildDocument("https://hermespass.asia", [
      {
        keyFragment: "issuer-current",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "current" },
        active: true,
      },
      {
        keyFragment: "issuer-old",
        publicJwk: { kty: "OKP", crv: "Ed25519", x: "old" },
        active: false,
      },
    ]);

    expect(document.verificationMethod.map(({ id }) => id)).toEqual([
      "did:web:hermespass.asia#issuer-current",
      "did:web:hermespass.asia#issuer-old",
    ]);
    expect(document.assertionMethod).toEqual(["did:web:hermespass.asia#issuer-current"]);
    expect(document.authentication).toEqual(["did:web:hermespass.asia#issuer-current"]);
  });

  it("keeps a revoked agent key resolvable without authorizing it", () => {
    const document = agentDidDocument(
      "https://hermespass.asia",
      "retired-agent",
      { kty: "OKP", crv: "Ed25519", x: "retired" },
      "agent-1",
      false,
    );

    expect(document.verificationMethod).toHaveLength(1);
    expect(document.authentication).toEqual([]);
    expect(document.assertionMethod).toEqual([]);
  });

  it.each([
    [
      "swapped subject",
      passport({
        credentialSubject: {
          ...passport().credentialSubject,
          id: "did:web:hermespass.asia:agent:other",
        },
      }),
    ],
    ["wrong issuer", passport({ issuer: "did:web:evil.example" })],
    ["wrong credential id", passport({ id: "urn:uuid:other" })],
    ["future credential", passport({ validFrom: "2026-07-01T00:00:00.000Z" })],
    ["expired credential", passport({ validUntil: "2026-05-31T23:59:59.000Z" })],
    [
      "stored validity mismatch",
      passport({
        validFrom: "2026-02-01T00:00:00.000Z",
        validUntil: "2026-12-01T00:00:00.000Z",
      }),
    ],
    [
      "claim mismatch",
      passport({ credentialSubject: { ...passport().credentialSubject, role: "Finance" } }),
    ],
    ["wrong context", passport({ "@context": ["https://www.w3.org/ns/credentials/v2"] })],
    [
      "malformed typed claim",
      passport({ credentialSubject: { ...passport().credentialSubject, spendCapHKD: "0" } }),
    ],
  ])("rejects a valid signature with %s", async (_label, payload) => {
    const pair = await generateEd25519KeyPair();
    const jws = await signPayload(payload, pair.privateJwk);

    await expect(
      verifyBoundCredential(
        jws,
        pair.publicJwk,
        "did:web:hermespass.asia#issuer-1",
        expectedCredential,
      ),
    ).rejects.toThrow();
  });

  it("accepts only two-decimal browser caps and converts once to integer cents", () => {
    const base = {
      name: "Test agent",
      role: "Support",
      risk: "low",
      scopes: ["catalog.read"],
      governanceNotes: null,
    };

    expect(issueAgentInput.parse({ ...base, spendCap: 12.34 })).toMatchObject({
      spendCapCents: 1234,
    });
    expect(issueAgentInput.parse({ ...base, spendCap: 0.1 })).toMatchObject({ spendCapCents: 10 });
    expect(() => issueAgentInput.parse({ ...base, spendCap: 12.345 })).toThrow();
  });
});
