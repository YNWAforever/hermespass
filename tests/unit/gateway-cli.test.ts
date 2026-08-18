import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { generateEd25519KeyPair } from "@/lib/identity/keys";
import { verifyGatewaySignature } from "@/lib/policy/action";
import { parseGatewayCliArgs, runGatewayCli } from "../../scripts/gateway-decide";

const cryptoApi = globalThis.crypto ?? webcrypto;

const action = {
  version: "1",
  agentDid: "did:web:hermespass.test:agents:cli-bot",
  keyId: "33333333-3333-4333-8333-333333333333",
  tool: "vendor.contract",
  summary: "Approve a signed vendor contract digest",
  justification: null,
  payloadDigest: Buffer.alloc(32, 17).toString("base64url"),
  amountCents: 10_000,
  currency: "HKD",
  merchantCategoryCode: "7399",
  nonce: "66666666-6666-4666-8666-666666666666",
  timestamp: "2026-08-18T03:00:00.000Z",
} as const;

describe("gateway integration CLI", () => {
  it("requires explicit endpoint, action, and external private-JWK paths", () => {
    expect(
      parseGatewayCliArgs([
        "--endpoint",
        "http://localhost:3000/api/gateway/decide",
        "--action",
        "C:\\requests\\action.json",
        "--private-jwk",
        "D:\\agent-secrets\\agent.jwk",
      ]),
    ).toEqual({
      endpoint: "http://localhost:3000/api/gateway/decide",
      actionPath: "C:\\requests\\action.json",
      privateJwkPath: "D:\\agent-secrets\\agent.jwk",
    });
    expect(() => parseGatewayCliArgs(["--endpoint", "http://localhost:3000"])).toThrow(
      "GATEWAY_CLI_USAGE",
    );
  });

  it("signs canonical bytes from an external JWK without printing private material", async () => {
    const pair = await generateEd25519KeyPair();
    const privateJwkText = JSON.stringify(pair.privateJwk);
    const readFile = vi.fn(async (path: string) => {
      if (path === "C:\\requests\\action.json") return JSON.stringify(action);
      if (path === "D:\\agent-secrets\\agent.jwk") return privateJwkText;
      throw new Error("UNEXPECTED_PATH");
    });
    let sentBody = "";
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return Response.json({ data: { decision: "allow", reasonCode: "POLICY_ALLOWED" } });
    });
    const output: string[] = [];

    const exitCode = await runGatewayCli(
      [
        "--endpoint",
        "http://localhost:3000/api/gateway/decide",
        "--action",
        "C:\\requests\\action.json",
        "--private-jwk",
        "D:\\agent-secrets\\agent.jwk",
      ],
      {
        readFile,
        fetch: fetchImpl,
        writeOutput: (value) => output.push(value),
        crypto: cryptoApi,
      },
    );

    const signedRequest = JSON.parse(sentBody) as { action: typeof action; signature: string };
    expect(exitCode).toBe(0);
    expect(readFile).toHaveBeenCalledWith("D:\\agent-secrets\\agent.jwk", "utf8");
    await expect(
      verifyGatewaySignature(signedRequest.action, signedRequest.signature, pair.publicJwk),
    ).resolves.toBe(true);
    expect(output).toEqual([
      JSON.stringify({ data: { decision: "allow", reasonCode: "POLICY_ALLOWED" } }, null, 2),
    ]);
    expect(output.join("\n")).not.toContain(String(pair.privateJwk.d));
    expect(output.join("\n")).not.toContain(privateJwkText);
  });
});
