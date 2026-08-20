import { describe, expect, it } from "vitest";

import {
  normalizeOrganizationInput,
  normalizeInviteEmail,
  createInviteToken,
  hashInviteToken,
  tierAgentLimit,
} from "@/lib/orgs/validation";

describe("productization onboarding validation", () => {
  it("normalizes and validates organization names and slugs", () => {
    expect(normalizeOrganizationInput({ name: "  Acme  ", slug: "Acme HK" })).toEqual({
      name: "Acme",
      slug: "acme-hk",
    });
    expect(() => normalizeOrganizationInput({ name: "", slug: "acme" })).toThrow(
      "ORGANIZATION_INVALID",
    );
    expect(() => normalizeOrganizationInput({ name: "Acme", slug: "../bad" })).toThrow(
      "ORGANIZATION_INVALID",
    );
  });

  it("normalizes invite email and issues only hashable one-time tokens", () => {
    const email = normalizeInviteEmail(" Owner@Example.COM ");
    expect(email).toBe("owner@example.com");
    expect(() => normalizeInviteEmail("not-an-email")).toThrow("INVITE_INVALID");
    const token = createInviteToken();
    expect(token.raw).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(hashInviteToken(token.raw)).toHaveLength(32);
    expect(hashInviteToken(token.raw)).not.toEqual(token.raw);
  });

  it("maps product tiers to the approved active-agent limits", () => {
    expect(["pilot", "starter", "growth", "scale"].map(tierAgentLimit)).toEqual([3, 5, 25, 100]);
    expect(tierAgentLimit("unknown")).toBe(0);
  });
});
