import { afterEach, describe, expect, it, vi } from "vitest";

import { generateEd25519KeyPair } from "@/lib/identity/keys";
import { buildPassportCredential, signPassportCredential } from "@/lib/identity/vc";
import { safeVerificationDto, verifyWithApiKey } from "@/lib/productization/verification";

const database = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({
  withPublicDatabase: async (
    operation: (client: {
      execute: typeof database.execute;
      transaction: (
        callback: (client: { execute: typeof database.execute }) => Promise<unknown>,
      ) => Promise<unknown>;
    }) => Promise<unknown>,
  ) =>
    operation({
      execute: database.execute,
      transaction: async (callback) => callback({ execute: database.execute }),
    }),
}));
vi.mock("@/lib/auth/authorization", () => ({
  assertCanMutate: vi.fn(),
  withActorTransaction: vi.fn(),
}));

import { verifyPublicAgent, verifyPublicAgentByDid } from "@/lib/agents/service";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  database.execute.mockReset();
  delete process.env["HERMES_ISSUER_ORIGIN"];
});

describe("public passport verification", () => {
  it("verifies a valid credential when public SQL returns timestamp strings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    process.env["HERMES_ISSUER_ORIGIN"] = "https://hermespass.asia";

    const pair = await generateEd25519KeyPair();
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    const credentialId = "urn:uuid:22222222-2222-4222-8222-222222222222";
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
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            slug: "test-agent",
            did,
            name: "Test Agent",
            role: "Support",
            organization_name: "Hermes Holdings APAC",
            organization_slug: "hermes-holdings-apac",
            risk: "low",
            scopes: ["catalog.read"],
            spend_cap_cents: "1234",
            status: "active",
            credential_id: credentialId,
            credential_jws: credentialJws,
            issued_at: issuedAt.toISOString(),
            expires_at: expiresAt.toISOString(),
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

    await expect(verifyPublicAgentByDid(did)).resolves.toMatchObject({
      valid: true,
      status: "active",
      did,
      checks: {
        signature: true,
        issuer: true,
        expiry: true,
        storedStatus: "active",
      },
    });
  });

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
describe("metered public verification", () => {
  it("projects only safe public credential fields", () => {
    const result = safeVerificationDto({
      valid: true,
      status: "active",
      did: "did:web:hermespass.asia:agent:demo",
      credentialId: "urn:uuid:credential",
      issuer: "did:web:hermespass.asia",
      credential: { credentialSubject: { id: "did:web:hermespass.asia:agent:demo" } },
      organizationId: "secret-org",
      governanceNotes: "secret notes",
      credentialJws: "secret-jws",
      publicJwk: { kty: "OKP", crv: "Ed25519", x: "secret" },
      apiKey: "hp_live_secret",
    });
    expect(result).toEqual({
      valid: true,
      status: "active",
      did: "did:web:hermespass.asia:agent:demo",
      credentialId: "urn:uuid:credential",
      issuer: "did:web:hermespass.asia",
      credential: { credentialSubject: { id: "did:web:hermespass.asia:agent:demo" } },
    });
    expect(JSON.stringify(result)).not.toContain("secret-org");
    expect(JSON.stringify(result)).not.toContain("secret-jws");
  });

  it("rejects missing or ambiguous bearer credentials before database access", async () => {
    const request = new Request(
      "http://localhost/api/v1/verify/did:web:hermespass.asia:agent:demo",
    );
    await expect(verifyWithApiKey(request, "did:web:hermespass.asia:agent:demo")).rejects.toThrow(
      "API_KEY_REQUIRED",
    );
    const ambiguous = new Request(request, {
      headers: { authorization: "Bearer hp_live_one, Bearer hp_live_two" },
    });
    await expect(verifyWithApiKey(ambiguous, "did:web:hermespass.asia:agent:demo")).rejects.toThrow(
      "API_KEY_INVALID",
    );
  });
  it("meters a valid key before returning a safe unknown-DID 404", async () => {
    database.execute
      .mockResolvedValueOnce({
        rows: [{ api_key_id: "key-id", allowed: true, retry_after_seconds: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const request = new Request(
      "http://localhost/api/v1/verify/did:web:hermespass.asia:agent:missing",
      { headers: { authorization: "Bearer hp_live_unknown_did" } },
    );
    await expect(
      verifyWithApiKey(request, "did:web:hermespass.asia:agent:missing"),
    ).rejects.toThrow("AGENT_NOT_FOUND");
    expect(database.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe DIDs and oversized requests before database access", async () => {
    const unsafeRequest = new Request("http://localhost/api/v1/verify/unsafe", {
      headers: { authorization: "Bearer hp_live_public_demo" },
    });
    await expect(verifyWithApiKey(unsafeRequest, "https://example.test/agent")).rejects.toThrow(
      "DID_INVALID",
    );
    const oversizedRequest = new Request("http://localhost/api/v1/verify/oversized", {
      headers: {
        authorization: "Bearer hp_live_public_demo",
        "content-length": String(16 * 1024 + 1),
      },
    });
    await expect(
      verifyWithApiKey(oversizedRequest, "did:web:hermespass.asia:agent:demo"),
    ).rejects.toThrow("PAYLOAD_TOO_LARGE");
    expect(database.execute).not.toHaveBeenCalled();
  });
});
