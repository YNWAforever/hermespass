import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DASHBOARD_ROUTES, PUBLIC_ROUTES, ROUTES, VISUAL_PARITY_ROUTES } from "../fixtures/routes";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Phase 5 release gates", () => {
  it("keeps the 39 public, 5 dashboard, and 5 visual route contracts frozen", () => {
    expect(PUBLIC_ROUTES).toHaveLength(39);
    expect(DASHBOARD_ROUTES).toHaveLength(5);
    expect(ROUTES).toHaveLength(44);
    expect(new Set(ROUTES).size).toBe(44);
    expect(VISUAL_PARITY_ROUTES).toEqual([
      "/",
      "/contact",
      "/roi-calculator",
      "/zh-hant",
      "/zh-hans/pricing",
    ]);
  });

  it("exposes the deterministic Phase 5 source gates without provider secrets", () => {
    const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    const workflow = source(".github/workflows/ci.yml");
    expect(packageJson.scripts["db:check"]).toBe("drizzle-kit check");
    for (const command of [
      "bun install --frozen-lockfile",
      "bun run format:check",
      "bun run lint",
      "bun run typecheck",
      "bun run test",
      "bun run db:check",
      "bun x drizzle-kit generate --name=ci_consistency",
      "image: postgres:18",
      "bun run test:db",
      "bun run build",
      "bun run test:e2e",
      "playwright.productization.config.ts",
    ]) {
      expect(workflow, command).toContain(command);
    }
    expect(workflow).toContain("Neon Phase 5 ephemeral smoke (approval-gated)");
    expect(workflow).toContain("needs: [postgres-integration, parity, productization]");
    expect(workflow).not.toMatch(
      /(STRIPE_SECRET_KEY|STRIPE_BILLING_WEBHOOK_SECRET|COMMS_INBOUND_SECRET|REPORT_EXPORT_SECRET):/,
    );
    expect(workflow).not.toMatch(/(sk_live_|whsec_|-----BEGIN (RSA|EC|OPENSSH|PRIVATE))/i);
  });

  it("keeps the launch runbook explicit about evidence and approval gates", () => {
    expect(existsSync(join(process.cwd(), "docs/launch-readiness.md"))).toBe(true);
    expect(existsSync(join(process.cwd(), "docs/release/phase-5-gates.md"))).toBe(true);
    const runbook = source("docs/release/phase-5-gates.md").toLowerCase();
    for (const requirement of [
      "singapore-first",
      "two-tenant rls",
      "pitr",
      "audit-chain",
      "rate-limit",
      "imda",
      "hkma",
      "pen-test",
      "uptime",
      "error alerting",
      "nonproduction provider approval",
      "production release approval",
      "unchecked",
    ]) {
      expect(runbook, requirement).toContain(requirement);
    }
  });
});
