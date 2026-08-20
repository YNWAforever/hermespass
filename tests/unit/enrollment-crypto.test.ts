import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildEnrollmentProofMessage,
  generateEnrollmentToken,
  validatePublicEd25519Jwk,
  verifyEnrollmentProof,
} from "@/lib/agents/enrollment";
import { generateEd25519KeyPair } from "@/lib/identity/keys";

const cryptoApi = globalThis.crypto ?? webcrypto;

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString(
    "base64url",
  );
}

describe("BYOK enrollment cryptography", () => {
  it("creates an unpadded 32-byte token and stores only its SHA-256 hash", () => {
    const generated = generateEnrollmentToken();

    expect(generated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(generated.token, "base64url")).toHaveLength(32);
    expect(generated.tokenHash).toHaveLength(32);
    expect(generated.tokenHash).toEqual(
      createHash("sha256").update(generated.token, "utf8").digest(),
    );
    expect(generated.tokenHash.toString("base64url")).not.toBe(generated.token);
  });

  it("canonicalizes reordered proof fields and verifies Ed25519 possession", async () => {
    const pair = await generateEd25519KeyPair();
    const token = Buffer.alloc(32, 7).toString("base64url");
    const publicJwk = { x: pair.publicJwk.x, crv: "Ed25519", kty: "OKP" };
    const reorderedJwk = { kty: "OKP", x: pair.publicJwk.x, crv: "Ed25519" };
    const canonical = buildEnrollmentProofMessage(token, publicJwk);

    expect(buildEnrollmentProofMessage(token, reorderedJwk)).toEqual(canonical);

    const privateKey = await cryptoApi.subtle.importKey(
      "jwk",
      pair.privateJwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const proof = encodeBase64Url(
      await cryptoApi.subtle.sign({ name: "Ed25519" }, privateKey, canonical),
    );

    await expect(
      verifyEnrollmentProof({ token, publicJwk: reorderedJwk, proof }),
    ).resolves.toMatchObject({
      publicJwk: reorderedJwk,
      thumbprint: pair.thumbprint,
      keyFragment: `key-${pair.thumbprint}`,
      tokenHash: createHash("sha256").update(token, "utf8").digest(),
    });
  });

  it("rejects private, malformed, forged, or token-swapped proofs uniformly", async () => {
    const pair = await generateEd25519KeyPair();
    const token = Buffer.alloc(32, 8).toString("base64url");
    const publicJwk = { kty: "OKP", crv: "Ed25519", x: pair.publicJwk.x };
    const privateKey = await cryptoApi.subtle.importKey(
      "jwk",
      pair.privateJwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const proof = encodeBase64Url(
      await cryptoApi.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        buildEnrollmentProofMessage(token, publicJwk),
      ),
    );

    expect(() => validatePublicEd25519Jwk({ ...publicJwk, d: pair.privateJwk.d })).toThrow(
      "AGENT_ENROLLMENT_INVALID",
    );
    expect(() => validatePublicEd25519Jwk({ ...publicJwk, x: "short" })).toThrow(
      "AGENT_ENROLLMENT_INVALID",
    );
    expect(() => validatePublicEd25519Jwk({ ...publicJwk, x: `${publicJwk.x}=` })).toThrow(
      "AGENT_ENROLLMENT_INVALID",
    );

    for (const input of [
      { token, publicJwk, proof: `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}` },
      { token: Buffer.alloc(32, 9).toString("base64url"), publicJwk, proof },
      { token, publicJwk: { ...publicJwk, x: Buffer.alloc(32, 4).toString("base64url") }, proof },
    ]) {
      await expect(verifyEnrollmentProof(input)).rejects.toThrow("AGENT_ENROLLMENT_INVALID");
    }
  });
});
