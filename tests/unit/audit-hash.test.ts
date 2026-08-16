import { describe, expect, it } from "vitest";

import { hashAuditEntry, verifyAuditChain, type AuditEntryForHash } from "@/lib/audit/hash";

const base: AuditEntryForHash = {
  organizationId: "org-1",
  agentId: "agent-1",
  actorType: "user",
  actorId: "user-1",
  action: "passport.issued",
  summary: "Passport issued",
  decision: "allow",
  tool: "passport.issue",
  amountCents: null,
  payload: { scopes: ["catalog.read"] },
  occurredAt: "2026-08-16T00:00:00.000Z",
  prevHash: null,
};

describe("audit hash chain", () => {
  it("detects a modified payload", async () => {
    const firstHash = await hashAuditEntry(base);
    const second = { ...base, action: "passport.revoked", prevHash: firstHash };
    const secondHash = await hashAuditEntry(second);
    await expect(
      verifyAuditChain([
        { ...base, hash: firstHash },
        { ...second, hash: secondHash },
      ]),
    ).resolves.toMatchObject({ valid: true, checked: 2 });
    await expect(
      verifyAuditChain([
        { ...base, hash: firstHash },
        { ...second, summary: "tampered", hash: secondHash },
      ]),
    ).resolves.toMatchObject({ valid: false, checked: 1 });
  });
});
