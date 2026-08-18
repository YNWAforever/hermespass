import { describe, expect, it } from "vitest";

import { agentDto } from "@/lib/agents/types";

describe("BYOK enrollment state", () => {
  it("reports enrollment required when a newly issued agent has no active key", () => {
    const result = agentDto({
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      slug: "new-agent",
      did: "did:web:example.test:agent:new-agent",
      name: "New agent",
      role: "Operator",
      risk: "low",
      scopes: ["catalog.read"],
      spendCapCents: 0,
      governanceNotes: null,
      status: "active",
      credentialId: "urn:uuid:33333333-3333-4333-8333-333333333333",
      credentialJws: "credential",
      issuedAt: new Date("2026-08-18T00:00:00.000Z"),
      expiresAt: new Date("2027-08-18T00:00:00.000Z"),
      createdBy: "user-1",
      createdAt: new Date("2026-08-18T00:00:00.000Z"),
      updatedAt: new Date("2026-08-18T00:00:00.000Z"),
      revokedAt: null,
      revokedBy: null,
      organizationName: "Test org",
      organizationSlug: "test-org",
      publicJwk: null,
      thumbprint: null,
      custody: null,
    });

    expect(result).toMatchObject({
      keyStatus: "enrollment_required",
      thumbprint: null,
      publicKey: null,
    });
  });
});
