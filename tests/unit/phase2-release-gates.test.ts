import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DASHBOARD_ROUTES, PUBLIC_ROUTES, ROUTES, VISUAL_PARITY_ROUTES } from "../fixtures/routes";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Phase 2 release gates", () => {
  it("keeps the public, dashboard, and visual route manifests frozen", () => {
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

  it("runs every required local CI gate with a frozen install", () => {
    const packageJson = JSON.parse(source("package.json")) as {
      scripts: Record<string, string>;
    };
    const workflow = source(".github/workflows/ci.yml");

    expect(packageJson.scripts["db:check"]).toBe("drizzle-kit check");
    for (const command of [
      "bun install --frozen-lockfile",
      "bun run format:check",
      "bun run lint",
      "bun run typecheck",
      "bun run test",
      "bun run db:check",
      "image: postgres:18",
      "bun run test:db",
      "bun run build",
      "bun run test:e2e",
    ]) {
      expect(workflow, command).toContain(command);
    }
  });

  it("keeps Telegram deterministic and hosted Neon smoke approval-gated", () => {
    const workflow = source(".github/workflows/ci.yml");

    expect(workflow).toContain("Neon Phase 2 ephemeral smoke (approval-gated)");
    expect(workflow).toContain("HERMESPASS_NEON_SMOKE == 'true'");
    expect(workflow).toContain("needs: postgres-integration");
    expect(workflow).toContain("DATABASE_URL_TEST: ${{ secrets.HERMESPASS_NEON_SMOKE_URL }}");
    expect(workflow).toContain("bun run test:db:smoke");
    expect(workflow).not.toContain("TELEGRAM_BOT_TOKEN:");
    expect(workflow).not.toContain("TELEGRAM_WEBHOOK_SECRET:");
  });

  it("documents preview evidence and separate provider approval gates", () => {
    const runbookPath = "docs/release/phase-2-gates.md";
    expect(existsSync(join(process.cwd(), runbookPath))).toBe(true);

    const runbook = source(runbookPath);
    for (const requirement of [
      "implementation in progress",
      "BYOK enrollment",
      "policy creation",
      "automatic allow and deny",
      "concurrent caps",
      "web approval",
      "Telegram approval",
      "delivery retry",
      "approval expiry",
      "audit-chain validity",
      "Push and pull request approval",
      "Production release approval",
    ]) {
      expect(runbook.toLowerCase(), requirement).toContain(requirement.toLowerCase());
    }
  });
});
