import { webcrypto } from "node:crypto";
import { calculateJwkThumbprint } from "jose";

const cryptoApi = globalThis.crypto ?? webcrypto;

export type GeneratedEd25519KeyPair = {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  thumbprint: string;
};

export async function generateEd25519KeyPair(): Promise<GeneratedEd25519KeyPair> {
  const pair = (await cryptoApi.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = (await cryptoApi.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const privateJwk = (await cryptoApi.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return {
    publicJwk,
    privateJwk,
    thumbprint: await calculateJwkThumbprint(publicJwk, "sha256"),
  };
}
