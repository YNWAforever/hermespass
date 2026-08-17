import { webcrypto } from "node:crypto";

export const ENVELOPE_ALGORITHM = "A256GCM+A256KW" as const;
export const KEK_VERSION = "v1" as const;

const cryptoApi = globalThis.crypto ?? webcrypto;

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export type EnvelopeAad = {
  environment: string;
  purpose: string;
  tenant: string;
  entity: string;
  keyId: string;
  version?: string;
};

export type EncryptedJwk = {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  wrappedDek: Uint8Array;
  kekVersion: typeof KEK_VERSION;
  algorithm: typeof ENVELOPE_ALGORITHM;
};

export function buildAad(input: EnvelopeAad): Uint8Array {
  const version = input.version ?? KEK_VERSION;
  return new TextEncoder().encode(
    `hermespass|${input.environment}|${input.purpose}|${input.tenant}|${input.entity}|${input.keyId}|${version}`,
  );
}

async function importKek(kek: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  if (kek.byteLength !== 32) throw new Error("KEK must be exactly 32 bytes");
  return cryptoApi.subtle.importKey(
    "raw",
    arrayBuffer(kek),
    { name: "AES-KW", length: 256 },
    false,
    usage,
  );
}

export async function encryptPrivateJwk(
  jwk: JsonWebKey,
  kek: Uint8Array,
  aad: Uint8Array,
): Promise<EncryptedJwk> {
  const dek = await cryptoApi.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(jwk));
  const ciphertext = new Uint8Array(
    await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv: arrayBuffer(iv), additionalData: arrayBuffer(aad), tagLength: 128 },
      dek,
      arrayBuffer(plaintext),
    ),
  );
  const wrappingKey = await importKek(kek, ["wrapKey"]);
  const wrappedDek = new Uint8Array(
    await cryptoApi.subtle.wrapKey("raw", dek, wrappingKey, "AES-KW"),
  );
  plaintext.fill(0);
  return { ciphertext, iv, wrappedDek, kekVersion: KEK_VERSION, algorithm: ENVELOPE_ALGORITHM };
}

export async function decryptPrivateJwk(
  encrypted: EncryptedJwk,
  kek: Uint8Array,
  aad: Uint8Array,
): Promise<JsonWebKey> {
  if (encrypted.kekVersion !== KEK_VERSION || encrypted.algorithm !== ENVELOPE_ALGORITHM) {
    throw new Error("Unsupported envelope format");
  }
  const wrappingKey = await importKek(kek, ["unwrapKey"]);
  const dek = await cryptoApi.subtle.unwrapKey(
    "raw",
    arrayBuffer(encrypted.wrappedDek),
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = new Uint8Array(
    await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: arrayBuffer(encrypted.iv),
        additionalData: arrayBuffer(aad),
        tagLength: 128,
      },
      dek,
      arrayBuffer(encrypted.ciphertext),
    ),
  );
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
  } finally {
    plaintext.fill(0);
  }
}
