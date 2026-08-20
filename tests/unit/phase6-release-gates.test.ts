import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8").toLowerCase();
}

describe("Phase 6 release gates", () => {
  it("keeps the Neon-first evidence ledger explicit", () => {
    const runbook = source("docs/release/phase-6-gates.md");
    for (const requirement of [
      "neon",
      "hermes_app",
      "pitr",
      "two-tenant rls",
      "secret inventory",
      "rate limit",
      "penetration",
      "uptime",
      "error alerting",
      "nonproduction provider approval",
      "production release approval",
      "unchecked",
    ]) {
      expect(runbook, requirement).toContain(requirement);
    }
    expect(runbook).not.toContain("supabase");
  });

  it("keeps CI provider-free while invoking the offline preflight", () => {
    const workflow = source(".github/workflows/ci.yml");
    expect(workflow).toContain("phase 6 offline release preflight");
    expect(workflow).toContain("bun run release:phase6");
    expect(workflow).not.toMatch(/(STRIPE_SECRET_KEY|COMMS_INBOUND_SECRET|NEON_API_KEY):/i);
    expect(workflow).not.toMatch(/(sk_live_|whsec_|-----begin .*private)/i);
  });

  it("documents the provider boundary in the repository guidance", () => {
    const readme = source("README.md");
    const agents = source("AGENTS.md");
    expect(readme).toContain("phase 6");
    expect(agents).toContain("phase 6");
    expect(agents).toContain("neon");
    expect(agents).toContain("provider");
  });
});
