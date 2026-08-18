import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildEnrollmentProofMessage, verifyEnrollmentProof } from "@/lib/agents/enrollment";
import { generateEd25519KeyPair } from "@/lib/identity/keys";
import {
  canonicalGatewayActionBytes,
  verifyGatewaySignature,
  type GatewayActionV1,
} from "@/lib/policy/action";
import { gatewayTimeState } from "@/lib/policy/time";

const cryptoApi = globalThis.crypto ?? webcrypto;

const action: GatewayActionV1 = {
  version: "1",
  agentDid: "did:web:hermespass.test:agents:signature-bot",
  keyId: "33333333-3333-4333-8333-333333333333",
  tool: "catalog.read",
  summary: "Read the signed catalog digest",
  justification: null,
  payloadDigest: Buffer.alloc(32, 17).toString("base64url"),
  amountCents: null,
  currency: null,
  merchantCategoryCode: null,
  nonce: "66666666-6666-4666-8666-666666666666",
  timestamp: "2026-08-18T03:00:00.000Z",
};

describe("gateway signature and freshness rejection", () => {
  it("rejects a canonical signature under the wrong Ed25519 public key", async () => {
    const signer = await generateEd25519KeyPair();
    const other = await generateEd25519KeyPair();
    const privateKey = await cryptoApi.subtle.importKey(
      "jwk",
      signer.privateJwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const signature = Buffer.from(
      await cryptoApi.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        canonicalGatewayActionBytes(action),
      ),
    ).toString("base64url");

    await expect(verifyGatewaySignature(action, signature, other.publicJwk)).resolves.toBe(false);
  });

  it("verifies gateway requests with the same kid-bearing JWK accepted by enrollment", async () => {
    const pair = await generateEd25519KeyPair();
    const publicJwk = {
      ...pair.publicJwk,
      kid: "did:web:hermespass.test:agents:signature-bot#external-1",
    };
    const token = Buffer.alloc(32, 29).toString("base64url");
    const privateKey = await cryptoApi.subtle.importKey(
      "jwk",
      pair.privateJwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const proof = Buffer.from(
      await cryptoApi.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        buildEnrollmentProofMessage(token, publicJwk),
      ),
    ).toString("base64url");
    const enrolled = await verifyEnrollmentProof({ token, publicJwk, proof });
    const signature = Buffer.from(
      await cryptoApi.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        canonicalGatewayActionBytes(action),
      ),
    ).toString("base64url");

    expect(enrolled.publicJwk).toEqual(publicJwk);
    await expect(verifyGatewaySignature(action, signature, enrolled.publicJwk)).resolves.toBe(true);
  });

  it("rejects future timestamps and accepts the exact current instant", () => {
    const now = new Date("2026-08-18T03:00:00.000Z");
    expect(gatewayTimeState("2026-08-18T03:00:00.001Z", now).fresh).toBe(false);
    expect(gatewayTimeState("2026-08-18T03:00:00.000Z", now).fresh).toBe(true);
  });
});
