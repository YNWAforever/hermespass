import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
}));

vi.mock("@/lib/gateway/service", () => ({
  decideGatewayRequest: mocks.decide,
}));

const action = {
  version: "1",
  agentDid: "did:web:hermespass.test:agents:route-bot",
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

const signedRequest = {
  action,
  signature: Buffer.alloc(64, 31).toString("base64url"),
};

const denial = {
  requestId: "44444444-4444-4444-8444-444444444444",
  decision: "deny",
  reasonCode: "PER_TRANSACTION_LIMIT_EXCEEDED",
  reason: "The amount exceeds the per-transaction limit.",
  policyVersion: 7,
  approvalId: null,
  decidedAt: "2026-08-18T03:01:00.000Z",
  authorizationExpiresAt: null,
  retryAfterSeconds: null,
} as const;

function post(body: string, headers: HeadersInit = {}): Request {
  return new Request("http://localhost/api/gateway/decide", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-request-id": "req-gateway",
      ...headers,
    },
  });
}

beforeEach(() => {
  mocks.decide.mockReset();
  mocks.decide.mockResolvedValue(denial);
});

describe("POST /api/gateway/decide", () => {
  it("returns an audited policy denial in the standard HTTP 200 data envelope", async () => {
    const { POST } = await import("@/app/api/gateway/decide/route");

    const response = await POST(post(JSON.stringify(signedRequest)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: denial });
    expect(mocks.decide).toHaveBeenCalledWith(signedRequest);
  });

  it("returns 400 for malformed JSON or an invalid signed schema", async () => {
    const { POST } = await import("@/app/api/gateway/decide/route");

    const malformed = await POST(post("{not-json"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "The request body must contain valid JSON.",
        requestId: "req-gateway",
      },
    });

    const invalid = await POST(post(JSON.stringify({ ...signedRequest, extra: true })));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: "req-gateway" },
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("returns INVALID_JSON for malformed UTF-8 instead of decoding replacement characters", async () => {
    const { POST } = await import("@/app/api/gateway/decide/route");
    const request = new Request("http://localhost/api/gateway/decide", {
      method: "POST",
      body: Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
      headers: { "content-type": "application/json", "x-request-id": "req-gateway" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "The request body must contain valid JSON.",
        requestId: "req-gateway",
      },
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("returns 413 for declared or streamed bodies over 16 KiB", async () => {
    const { POST } = await import("@/app/api/gateway/decide/route");

    const declared = await POST(post("{}", { "content-length": String(16 * 1_024 + 1) }));
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({
      error: { code: "REQUEST_TOO_LARGE", requestId: "req-gateway" },
    });

    const streamed = await POST(post(JSON.stringify({ padding: "x".repeat(16 * 1_024) })));
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toMatchObject({
      error: { code: "REQUEST_TOO_LARGE", requestId: "req-gateway" },
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it.each([
    ["AGENT_AUTH_FAILED", 401],
    ["NONCE_CONFLICT", 409],
    ["GATEWAY_UNAVAILABLE", 503],
  ])("normalizes %s without leaking internals", async (code, status) => {
    mocks.decide.mockRejectedValueOnce(new Error(code));
    const { POST } = await import("@/app/api/gateway/decide/route");

    const response = await POST(post(JSON.stringify(signedRequest)));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({
      error: { code, requestId: "req-gateway" },
    });
  });
});
