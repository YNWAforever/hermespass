import { describe, expect, it } from "vitest";

import { buildAad, decryptPrivateJwk, encryptPrivateJwk } from "@/lib/crypto/envelope";
import { generateEd25519KeyPair } from "@/lib/identity/keys";
import { agentDidDocument, agentDidForOrigin, didWebForOrigin } from "@/lib/identity/did";
import {
  buildPassportCredential,
  oneCalendarYearLater,
  signPassportCredential,
  verifyPassportCredential,
} from "@/lib/identity/vc";

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
      id: "urn:uuid:credential-1",
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
});
