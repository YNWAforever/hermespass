import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/auth/authorization";
import { provisionCard } from "@/lib/payments/card-service";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  assertCanMutate(actor: Actor) {
    if (actor.role !== "owner" && actor.role !== "admin") {
      throw Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" });
    }
  },
  withActorTransaction() {
    throw new Error("unexpected transaction");
  },
}));

const viewerActor: Actor = {
  userId: "viewer-1",
  email: "viewer@example.com",
  name: "Viewer",
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Example Org",
  organizationSlug: "example-org",
  role: "viewer",
};

describe("card provisioning", () => {
  it("defines a bounded stale-reservation recovery path", () => {
    const source = readFileSync("src/lib/payments/card-service.ts", "utf8");

    expect(source).toMatch(/PROVISIONING_STALE_AFTER_MS\s*=\s*\d+/);
    expect(source).toContain('current?.status === "provisioning"');
    expect(source).toContain("current.updatedAt.getTime() <= staleBefore.getTime()");
  });

  it("guards reservation takeover finalization and cancellation with an attempt token", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const service = readFileSync("src/lib/payments/card-service.ts", "utf8");

    expect(schema).toContain('provisioningToken: uuid("provisioning_token")');
    expect(service).toContain("const attemptToken = randomUUID()");
    expect(service.match(/eq\(walletCards\.provisioningToken, attemptToken\)/g)).toHaveLength(2);
    expect(service).toContain("provisioningToken: null");
  });

  it("binds the cardholder key and provider payload to one normalized organization name", () => {
    const service = readFileSync("src/lib/payments/card-service.ts", "utf8");

    expect(service).toContain("normalizeCardholderName");
    expect(service).toContain("cardholderIdempotencyKey(actor.organizationId, cardholderName)");
    expect(service).toContain("organizationName: cardholderName");
  });
  it("threads deterministic idempotency through cardholder creation", () => {
    const service = readFileSync("src/lib/payments/card-service.ts", "utf8");
    const railTypes = readFileSync("src/lib/payments/rails/types.ts", "utf8");
    const stripe = readFileSync("src/lib/payments/rails/stripe.ts", "utf8");

    expect(railTypes).toMatch(/ensureCardholder\(input:\s*\{[^}]*idempotencyKey:\s*string/s);
    expect(service).toContain("idempotencyKey: cardholderKey");
    expect(stripe).toMatch(/cardholders\.create\([\s\S]*idempotencyKey: input\.idempotencyKey/);
  });
  it("requires an owner or administrator before any database or rail work", async () => {
    await expect(
      provisionCard(viewerActor, "00000000-0000-4000-8000-000000000002"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
