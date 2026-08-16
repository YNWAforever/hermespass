import { afterEach, describe, expect, it, vi } from "vitest";

import { generateEd25519KeyPair } from "@/lib/identity/keys";
import { buildPassportCredential, signPassportCredential } from "@/lib/identity/vc";

const database = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({
  withPublicDatabase: async (
    operation: (client: { execute: typeof database.execute }) => Promise<unknown>,
  ) => operation({ execute: database.execute }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  assertCanMutate: vi.fn(),
  withActorTransaction: vi.fn(),
}));

import { verifyPublicAgent } from "@/lib/agents/service";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  database.execute.mockReset();
  delete process.env["HERMES_ISSUER_ORIGIN"];
});

describe("public passport verification", () => {
  it("reports a validly signed credential as expired at its exclusive boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    process.env["HERMES_ISSUER_ORIGIN"] = "https://hermespass.asia";

    const pair = await generateEd25519KeyPair();
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    const credentialId = "urn:uuid:11111111-1111-4111-8111-111111111111";
    const did = "did:web:hermespass.asia:agent:test-agent";
    const credential = buildPassportCredential({
      id: credentialId,
      issuer: "did:web:hermespass.asia",
      issuedAt,
      expiresAt,
      subject: {
        id: did,
        name: "Test Agent",
        role: "Support",
        ownerOrganization: "Hermes Holdings APAC",
        ownerOrganizationSlug: "hermes-holdings-apac",
        riskTier: "low",
        capabilities: ["catalog.read"],
        spendCapHKD: 12.34,
      },
    });
    const credentialJws = await signPassportCredential(
      credential,
      pair.privateJwk,
      "did:web:hermespass.asia#issuer-1",
    );

    database.execute
      .mockResolvedValueOnce({
        rows: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            slug: "test-agent",
            did,
            name: "Test Agent",
            role: "Support",
            organization_name: "Hermes Holdings APAC",
            organization_slug: "hermes-holdings-apac",
            risk: "low",
            scopes: ["catalog.read"],
            spend_cap_cents: 1234,
            status: "active",
            credential_id: credentialId,
            credential_jws: credentialJws,
            issued_at: issuedAt,
            expires_at: expiresAt,
            public_jwk: null,
            thumbprint: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            did: "did:web:hermespass.asia",
            key_fragment: "issuer-1",
            public_jwk: pair.publicJwk,
            thumbprint: "issuer-thumbprint",
          },
        ],
      });

    await expect(verifyPublicAgent("test-agent")).resolves.toMatchObject({
      valid: false,
      status: "expired",
      did,
      checks: {
        signature: true,
        issuer: true,
        expiry: false,
        storedStatus: "active",
      },
    });
  });
});
