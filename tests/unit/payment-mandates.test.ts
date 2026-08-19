import { describe, expect, it } from "vitest";

import {
  canonicalMandateBytes,
  mandateMatchesCharge,
  verifyMandate,
} from "@/lib/payments/mandates";
import type { MandateBodyV1, MandateVerificationKey, SignedMandateV1 } from "@/lib/payments/types";

const BODY: MandateBodyV1 = {
  version: "1",
  mandateId: "4c0c7b5b-5d2e-4e56-a03a-4cbf2464e6bc",
  agentDid: "did:web:hermespass.asia:agent:demo-agent",
  keyId: "fbb9a6a1-2d6b-4f4c-8c29-6c7c4f0a54dd",
  kind: "intent",
  nonce: "7d5b9d85-f7c8-4b94-9610-1a5c4e6a8d60",
  issuedAt: "2026-08-18T01:00:00.000Z",
  parentMandateId: null,
  constraints: {
    currency: "HKD",
    maxAmountCents: 50000,
    merchant: "AWS",
    mccAllowlist: ["5734", "7372"],
    expiresAt: "2026-09-18T01:00:00.000Z",
    oneTime: false,
  },
};

const SECRET_KEY = new Uint8Array(32).fill(7);

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fixtureKey(id = BODY.keyId): MandateVerificationKey {
  const publicKey = ed25519PublicKey();
  return {
    id,
    agentId: "d9d2e8a1-47fc-4d83-86a0-9e1700d13f8e",
    agentDid: BODY.agentDid,
    publicJwk: { kty: "OKP", crv: "Ed25519", x: base64url(publicKey) },
    status: "active",
    custody: "external",
  };
}

function ed25519PublicKey(): Uint8Array {
  return ed25519.getPublicKey(SECRET_KEY);
}

function signFixture(body: MandateBodyV1 = BODY): SignedMandateV1 {
  return {
    body,
    signature: base64url(ed25519.sign(canonicalMandateBytes(body), SECRET_KEY)),
  };
}

import { ed25519 } from "@noble/curves/ed25519.js";

describe("signed mandates", () => {
  it("uses RFC 8785 bytes independent of object insertion order", () => {
    const reordered = {
      constraints: BODY.constraints,
      nonce: BODY.nonce,
      version: BODY.version,
      parentMandateId: null,
      kind: BODY.kind,
      keyId: BODY.keyId,
      agentDid: BODY.agentDid,
      issuedAt: BODY.issuedAt,
      mandateId: BODY.mandateId,
    } satisfies MandateBodyV1;

    expect(Buffer.from(canonicalMandateBytes(BODY))).toEqual(
      Buffer.from(canonicalMandateBytes(reordered)),
    );
  });

  it("accepts the active external key and rejects tamper, wrong key, and expiry", () => {
    const signed = signFixture();
    const now = new Date("2026-08-19T00:00:00Z");

    expect(verifyMandate(signed, fixtureKey(), now)).toEqual({ valid: true });
    expect(
      verifyMandate(
        { ...signed, body: { ...BODY, nonce: "5cb2cfc8-bb4b-4c0a-8f45-8d398f497c38" } },
        fixtureKey(),
        now,
      ),
    ).toMatchObject({ valid: false, reasonCode: "MANDATE_SIGNATURE_INVALID" });
    expect(
      verifyMandate(signed, fixtureKey("2a7632f5-1e30-4c1e-8d05-3df1ff6dc5d1"), now),
    ).toMatchObject({
      valid: false,
      reasonCode: "MANDATE_KEY_MISMATCH",
    });
    expect(verifyMandate(signed, fixtureKey(), new Date("2026-10-01T00:00:00Z"))).toMatchObject({
      valid: false,
      reasonCode: "MANDATE_EXPIRED",
    });
  });

  it.each([
    ["amount", { amountCents: 50001, currency: "HKD" }, "MANDATE_AMOUNT_EXCEEDED"],
    [
      "merchant",
      { amountCents: 1000, currency: "HKD", merchantName: "Other" },
      "MANDATE_MERCHANT_MISMATCH",
    ],
    [
      "mcc",
      { amountCents: 1000, currency: "HKD", merchantName: "AWS", merchantCategoryCode: "7995" },
      "MANDATE_MCC_MISMATCH",
    ],
    ["currency", { amountCents: 1000, currency: "USD" }, "RAIL_CURRENCY_UNSUPPORTED"],
  ])("rejects %s charges", (_label, charge, reasonCode) => {
    expect(
      mandateMatchesCharge(BODY.constraints, {
        ...charge,
        at: new Date("2026-08-19T00:00:00Z"),
      }),
    ).toMatchObject({ matches: false, reasonCode });
  });

  it("rejects a missing merchant when the mandate binds a merchant", () => {
    expect(
      mandateMatchesCharge(BODY.constraints, {
        amountCents: 1000,
        currency: "HKD",
        merchantName: null,
        merchantCategoryCode: "5734",
        at: new Date("2026-08-19T00:00:00Z"),
      }),
    ).toMatchObject({ matches: false, reasonCode: "MANDATE_MERCHANT_MISMATCH" });
  });

  it("fails closed when the verification clock is invalid", () => {
    expect(verifyMandate(signFixture(), fixtureKey(), new Date("invalid"))).toMatchObject({
      valid: false,
      reasonCode: "MANDATE_SIGNATURE_INVALID",
    });
  });
  it("rejects a consumed one-time mandate", () => {
    expect(
      mandateMatchesCharge(
        { ...BODY.constraints, oneTime: true },
        {
          amountCents: 1000,
          currency: "HKD",
          merchantName: "AWS",
          merchantCategoryCode: "5734",
          at: new Date("2026-08-19T00:00:00Z"),
          alreadyConsumed: true,
        },
      ),
    ).toMatchObject({ matches: false, reasonCode: "MANDATE_ALREADY_CONSUMED" });
  });
});
