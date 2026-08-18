import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalGatewayActionBytes, gatewayActionSchema } from "../src/lib/policy/action";

type GatewayCliArgs = {
  endpoint: string;
  actionPath: string;
  privateJwkPath: string;
};

type GatewayCliDependencies = {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  fetch: typeof fetch;
  writeOutput: (value: string) => void;
  crypto: Pick<Crypto, "subtle">;
};

const defaultDependencies: GatewayCliDependencies = {
  readFile,
  fetch: globalThis.fetch,
  writeOutput: (value) => console.log(value),
  crypto: globalThis.crypto ?? webcrypto,
};

export function parseGatewayCliArgs(argv: string[]): GatewayCliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--")) throw new Error("GATEWAY_CLI_USAGE");
    values.set(flag, value);
  }

  const endpoint = values.get("--endpoint");
  const actionPath = values.get("--action");
  const privateJwkPath = values.get("--private-jwk");
  if (
    values.size !== 3 ||
    !endpoint ||
    !actionPath ||
    !privateJwkPath ||
    !["http:", "https:"].includes(new URL(endpoint).protocol)
  ) {
    throw new Error("GATEWAY_CLI_USAGE");
  }
  return { endpoint, actionPath, privateJwkPath };
}

function privateEd25519Jwk(value: unknown): JsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GATEWAY_PRIVATE_JWK_INVALID");
  }
  const jwk = value as JsonWebKey;
  if (
    jwk.kty !== "OKP" ||
    jwk.crv !== "Ed25519" ||
    typeof jwk.x !== "string" ||
    typeof jwk.d !== "string"
  ) {
    throw new Error("GATEWAY_PRIVATE_JWK_INVALID");
  }
  return jwk;
}

export async function runGatewayCli(
  argv: string[],
  dependencies: GatewayCliDependencies = defaultDependencies,
): Promise<0 | 1> {
  const options = parseGatewayCliArgs(argv);
  const [actionText, privateJwkText] = await Promise.all([
    dependencies.readFile(options.actionPath, "utf8"),
    dependencies.readFile(options.privateJwkPath, "utf8"),
  ]);
  const action = gatewayActionSchema.parse(JSON.parse(actionText));
  const privateKey = await dependencies.crypto.subtle.importKey(
    "jwk",
    privateEd25519Jwk(JSON.parse(privateJwkText)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await dependencies.crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      canonicalGatewayActionBytes(action),
    ),
  ).toString("base64url");

  const response = await dependencies.fetch(options.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, signature }),
  });
  const responseEnvelope: unknown = await response.json();
  dependencies.writeOutput(JSON.stringify(responseEnvelope, null, 2));
  return response.ok ? 0 : 1;
}

if (import.meta.main) {
  runGatewayCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      console.error("Gateway CLI failed. Check the supplied endpoint, action, and key files.");
      process.exitCode = 1;
    },
  );
}
