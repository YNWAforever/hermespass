import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mandatory authenticated dashboard coverage", () => {
  it("does not conditionally skip the authenticated route or interaction suites", () => {
    for (const path of ["tests/e2e/routes.spec.ts", "tests/e2e/interactions.spec.ts"]) {
      const contents = source(path);
      expect(contents).not.toContain("PLAYWRIGHT_AUTH_STATE");
      expect(contents).not.toContain("test.skip(!AUTH_STATE");
      expect(contents).toContain("E2E_AUTH_STORAGE_STATE");
    }
  });

  it("starts the Next parity server with an explicit isolated test adapter", () => {
    const setup = source("tests/e2e/global-setup.ts");
    expect(setup).toContain('HERMESPASS_E2E_ADAPTER: "1"');
    expect(setup).toContain("HERMESPASS_E2E_AUTH_SECRET");
    expect(setup).toContain('NEXT_PUBLIC_HERMESPASS_E2E_ADAPTER: "1"');
    expect(source("tests/e2e/support/auth-state.ts")).not.toContain("phase1-local-e2e");
  });

  it("keeps hosted Neon smoke separate and approval-gated", () => {
    const workflow = source(".github/workflows/ci.yml");
    expect(workflow).toContain("HERMESPASS_NEON_SMOKE == 'true'");
    expect(workflow).toContain("Run PostgreSQL 18 integration tests");
  });
});
