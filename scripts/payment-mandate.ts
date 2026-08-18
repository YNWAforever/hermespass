import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { ed25519 } from "@noble/curves/ed25519.js";
import { z } from "zod";

import { canonicalMandateBytes } from "../src/lib/payments/mandates";
import type { MandateBodyV1 } from "../src/lib/payments/types";

type PaymentMandateCliArgs = {
  privateJwkPath: string;
  agentDid: string;
  keyId: string;
  maxAmountCents: number;
  merchant: string;
};

type PaymentMandateCliDependencies = {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  fetch: typeof fetch;
  writeOutput: (value: string) => void;
  repositoryRoot: string;
  appBaseUrl?: string;
};

const privateJwkSchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z.string().regex(/^[A-Za-z0-9_-]+$/),
    d: z.string().regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const defaultDependencies: PaymentMandateCliDependencies = {
  readFile,
  fetch: globalThis.fetch,
  writeOutput: (value) => console.log(value),
  repositoryRoot: resolve(process.cwd()),
  appBaseUrl: process.env["APP_BASE_URL"],
};

function isPathInside(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate));
  return relation === "" || (!relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function decode32(value: string): Uint8Array {
  const decoded = Uint8Array.from(Buffer.from(value, "base64url"));
  if (decoded.length !== 32 || Buffer.from(decoded).toString("base64url") !== value) {
    throw new Error("PAYMENT_PRIVATE_JWK_INVALID");
  }
  return decoded;
}

function parsePrivateJwk(value: unknown): { d: Uint8Array; x: Uint8Array } {
  const jwk = privateJwkSchema.parse(value);
  const d = decode32(jwk.d);
  const x = decode32(jwk.x);
  if (!Buffer.from(ed25519.getPublicKey(d)).equals(Buffer.from(x))) {
    throw new Error("PAYMENT_PRIVATE_JWK_INVALID");
  }
  return { d, x };
}

export function parsePaymentMandateCliArgs(argv: string[]): PaymentMandateCliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--")) throw new Error("PAYMENT_MANDATE_USAGE");
    values.set(flag, value);
  }
  const privateJwkPath = values.get("--private-jwk");
  const agentDid = values.get("--agent-did");
  const keyId = values.get("--key-id");
  const maxAmountText = values.get("--max-cents");
  const merchant = values.get("--merchant")?.trim();
  const maxAmountCents = maxAmountText ? Number(maxAmountText) : NaN;
  if (
    values.size !== 5 ||
    !privateJwkPath ||
    !agentDid?.startsWith("did:web:") ||
    !z.string().uuid().safeParse(keyId).success ||
    !Number.isSafeInteger(maxAmountCents) ||
    maxAmountCents <= 0 ||
    !merchant ||
    merchant.length > 255
  ) {
    throw new Error("PAYMENT_MANDATE_USAGE");
  }
  return { privateJwkPath, agentDid, keyId: keyId!, maxAmountCents, merchant };
}

function output(
  status: number,
  mandateId: string | null,
  reasonCode: string,
  writeOutput: (value: string) => void,
): void {
  writeOutput(`HTTP_STATUS=${status}`);
  if (mandateId) writeOutput(`MANDATE_ID=${mandateId}`);
  writeOutput(`REASON_CODE=${reasonCode}`);
}

export async function runPaymentMandateCli(
  argv: string[],
  dependencies: PaymentMandateCliDependencies = defaultDependencies,
): Promise<0 | 1> {
  let options: PaymentMandateCliArgs;
  try {
    options = parsePaymentMandateCliArgs(argv);
  } catch (error) {
    output(
      0,
      null,
      error instanceof Error ? error.message : "PAYMENT_MANDATE_USAGE",
      dependencies.writeOutput,
    );
    return 1;
  }

  const privateJwkPath = resolve(options.privateJwkPath);
  if (isPathInside(dependencies.repositoryRoot, privateJwkPath)) {
    output(0, null, "PAYMENT_PRIVATE_JWK_PATH_FORBIDDEN", dependencies.writeOutput);
    return 1;
  }

  let signed: { body: MandateBodyV1; signature: string };
  try {
    const privateJwk = parsePrivateJwk(
      JSON.parse(await dependencies.readFile(privateJwkPath, "utf8")),
    );
    const issuedAt = new Date();
    const body: MandateBodyV1 = {
      version: "1",
      mandateId: crypto.randomUUID(),
      agentDid: options.agentDid,
      keyId: options.keyId,
      kind: "intent",
      nonce: crypto.randomUUID(),
      issuedAt: issuedAt.toISOString(),
      parentMandateId: null,
      constraints: {
        currency: "HKD",
        maxAmountCents: options.maxAmountCents,
        merchant: options.merchant,
        mccAllowlist: [],
        expiresAt: new Date(issuedAt.getTime() + 30 * 86_400_000).toISOString(),
        oneTime: false,
      },
    };
    signed = {
      body,
      signature: Buffer.from(ed25519.sign(canonicalMandateBytes(body), privateJwk.d)).toString(
        "base64url",
      ),
    };
  } catch (error) {
    output(
      0,
      null,
      error instanceof Error ? error.message : "PAYMENT_PRIVATE_JWK_INVALID",
      dependencies.writeOutput,
    );
    return 1;
  }

  const appBaseUrl = dependencies.appBaseUrl?.replace(/\/$/, "");
  if (!appBaseUrl) {
    output(0, signed.body.mandateId, "APP_BASE_URL_REQUIRED", dependencies.writeOutput);
    return 1;
  }

  try {
    const response = await dependencies.fetch(`${appBaseUrl}/api/mandates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed),
    });
    const responseBody = (await response.json().catch(() => null)) as {
      data?: { mandate?: { id?: string } };
      error?: { code?: string };
    } | null;
    const mandateId = responseBody?.data?.mandate?.id ?? null;
    const reasonCode =
      responseBody?.error?.code ?? (response.ok ? "MANDATE_ISSUED" : "MANDATE_REQUEST_FAILED");
    output(response.status, mandateId, reasonCode, dependencies.writeOutput);
    return response.ok ? 0 : 1;
  } catch {
    output(0, signed.body.mandateId, "MANDATE_REQUEST_FAILED", dependencies.writeOutput);
    return 1;
  }
}

if (import.meta.main) {
  runPaymentMandateCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
