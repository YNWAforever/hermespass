import { Pool, neonConfig } from "@neondatabase/serverless";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { issuerKeys, type PublicJwk } from "../src/db/schema";
import { buildAad, encryptPrivateJwk } from "../src/lib/crypto/envelope";
import { hermesKek, issuerOrigin, keyEnvironment, migrationDatabaseUrl } from "../src/lib/env";
import { didWebForOrigin } from "../src/lib/identity/did";
import { generateEd25519KeyPair } from "../src/lib/identity/keys";

neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: migrationDatabaseUrl(), max: 1 });
  const db = drizzle(pool);
  const origin = issuerOrigin();
  const did = didWebForOrigin(origin);
  const existing = await db
    .select({ id: issuerKeys.id })
    .from(issuerKeys)
    .where(and(eq(issuerKeys.did, did), eq(issuerKeys.status, "active")))
    .orderBy(desc(issuerKeys.createdAt))
    .limit(1);

  if (existing[0]) {
    console.log(`Issuer already configured for ${did}#issuer-1`);
    await pool.end();
    return;
  }

  const pair = await generateEd25519KeyPair();
  const encrypted = await encryptPrivateJwk(
    pair.privateJwk,
    hermesKek(),
    buildAad({
      environment: keyEnvironment(),
      purpose: "issuer-signing",
      tenant: "platform",
      entity: "issuer",
      keyId: "issuer-1",
    }),
  );

  await db.insert(issuerKeys).values({
    did,
    keyFragment: "issuer-1",
    publicJwk: pair.publicJwk as PublicJwk,
    thumbprint: pair.thumbprint,
    ciphertext: Buffer.from(encrypted.ciphertext),
    iv: Buffer.from(encrypted.iv),
    wrappedDek: Buffer.from(encrypted.wrappedDek),
    kekVersion: encrypted.kekVersion,
    encryptionAlgorithm: encrypted.algorithm,
    status: "active",
  });
  console.log(`Issuer bootstrap complete for ${did}#issuer-1`);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Issuer bootstrap failed");
  process.exitCode = 1;
});
