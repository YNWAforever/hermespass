import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secret: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ insuranceWebhookSecret: mocks.secret }));
vi.mock("@/lib/insurance/events", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/insurance/events")>("@/lib/insurance/events");
  return { ...actual, applyInsuranceWebhookEvent: mocks.apply };
});

import { POST } from "@/app/api/insurance/webhook/route";
import {
  canonicalInsuranceWebhookEvent,
  parseInsuranceWebhookBody,
  verifyInsuranceWebhookSecret,
} from "@/lib/insurance/events";

const event = {
  eventId: "evt-1",
  insurer: "mock",
  insurerPolicyId: "mockp-1",
  event: "lapsed",
  effectiveAt: "2026-08-20T00:00:00.000Z",
} as const;

function body(value: unknown): string {
  return JSON.stringify(value);
}

describe("insurance webhook parser", () => {
  it("accepts supported events, strips unknown fields, and computes a stable digest", () => {
    const parsed = parseInsuranceWebhookBody(
      new TextEncoder().encode(body({ ...event, secret: "never-store" })),
    );
    expect(parsed).toEqual(event);
    const canonical = canonicalInsuranceWebhookEvent(parsed);
    expect(canonical.payload).toEqual(event);
    expect(canonical.digest).toBe(
      createHash("sha256")
        .update(canonicalize(event) ?? "")
        .digest("hex"),
    );
  });

  it("rejects malformed, unsupported, oversized, and invalid UTF-8 payloads", () => {
    expect(() => parseInsuranceWebhookBody(new TextEncoder().encode("not-json"))).toThrow(
      "INSURANCE_WEBHOOK_INVALID",
    );
    expect(() =>
      parseInsuranceWebhookBody(new TextEncoder().encode(body({ ...event, event: "unknown" }))),
    ).toThrow("INSURANCE_WEBHOOK_INVALID");
    expect(() => parseInsuranceWebhookBody(new Uint8Array(16 * 1024 + 1))).toThrow(
      "INSURANCE_WEBHOOK_TOO_LARGE",
    );
    expect(() => parseInsuranceWebhookBody(Uint8Array.from([0xc3, 0x28]))).toThrow(
      "INSURANCE_WEBHOOK_INVALID",
    );
  });

  it("compares secrets in constant time and rejects missing values", () => {
    expect(verifyInsuranceWebhookSecret("secret", "secret")).toBe(true);
    expect(verifyInsuranceWebhookSecret("secret", "other")).toBe(false);
    expect(verifyInsuranceWebhookSecret(null, "secret")).toBe(false);
  });
});

describe("insurance webhook route", () => {
  it("authenticates before parsing and acknowledges applied or duplicate events safely", async () => {
    mocks.secret.mockReturnValue("webhook-secret");
    mocks.apply.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const request = () =>
      new Request("http://localhost/api/insurance/webhook", {
        method: "POST",
        headers: { "x-insurance-webhook-secret": "webhook-secret" },
        body: body({ ...event, unknown: "discard" }),
      });
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ data: { applied: true } });
    expect(mocks.apply).toHaveBeenCalledWith(event);
    const replay = await POST(request());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ data: { applied: false } });
  });

  it("fails closed when the webhook secret is missing", async () => {
    mocks.secret.mockImplementation(() => {
      throw new Error("INSURANCE_WEBHOOK_SECRET is required for insurance operations");
    });
    const response = await POST(
      new Request("http://localhost/api/insurance/webhook", { method: "POST", body: body(event) }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("INSURANCE_WEBHOOK_UNAVAILABLE");
  });

  it("rejects bad secrets, malformed bodies, and oversized bodies", async () => {
    mocks.apply.mockClear();
    mocks.secret.mockReturnValue("webhook-secret");
    const badSecret = await POST(
      new Request("http://localhost/api/insurance/webhook", {
        method: "POST",
        headers: { "x-insurance-webhook-secret": "wrong" },
        body: body(event),
      }),
    );
    expect(badSecret.status).toBe(401);
    expect(mocks.apply).not.toHaveBeenCalled();
    const malformed = await POST(
      new Request("http://localhost/api/insurance/webhook", {
        method: "POST",
        headers: { "x-insurance-webhook-secret": "webhook-secret" },
        body: "not-json",
      }),
    );
    expect(malformed.status).toBe(400);
    const oversized = await POST(
      new Request("http://localhost/api/insurance/webhook", {
        method: "POST",
        headers: { "x-insurance-webhook-secret": "webhook-secret" },
        body: "x".repeat(16 * 1024 + 1),
      }),
    );
    expect(oversized.status).toBe(413);
  });
});
