import { describe, expect, it, vi } from "vitest";

import {
  formatPhase6Result,
  runPhase6Cli,
  type Phase6CliEnvironment,
} from "../../scripts/phase6-release-preflight";

const fixture: Phase6CliEnvironment = {
  PHASE6_REQUIRED_VARIABLES: "DATABASE_URL,NEON_AUTH_COOKIE_SECRET,HERMES_KEK_V1",
  PHASE6_PRESENT_VARIABLES: "DATABASE_URL,NEON_AUTH_COOKIE_SECRET,HERMES_KEK_V1",
  PHASE6_DATABASE_URL: "postgresql://hermes_app:fixture@example.neon.tech/hermespass",
  PHASE6_DEPLOYMENT_BRANCH: "development",
  PHASE6_BASE_URL: "http://localhost:3000",
  PHASE6_ROUTE_CONTRACT: "pass",
};

describe("Phase 6 release CLI", () => {
  it("returns a passing redacted result for the fixture", () => {
    const result = runPhase6Cli(fixture, {
      migrationDiff: () => false,
      secretLiteralMatches: () => 0,
      routeContractOk: () => true,
    });
    expect(result.ok).toBe(true);
    expect(formatPhase6Result(result)).not.toContain("super-secret");
    expect(formatPhase6Result(result)).not.toContain("example.neon.tech");
  });

  it("fails with a stable code when a required variable name is absent", () => {
    const result = runPhase6Cli(
      { ...fixture, PHASE6_PRESENT_VARIABLES: "DATABASE_URL" },
      { migrationDiff: () => false, secretLiteralMatches: () => 0, routeContractOk: () => true },
    );
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toEqual({
      code: "MISSING_REQUIRED_VARIABLE",
      detail: "Missing required variables: HERMES_KEK_V1, NEON_AUTH_COOKIE_SECRET",
    });
  });

  it("fails closed on migration drift without contacting a network client", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = runPhase6Cli(fixture, {
      migrationDiff: () => true,
      secretLiteralMatches: () => 0,
      routeContractOk: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      code: "MIGRATION_DRIFT",
      detail: "Tracked schema has migration drift",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never places an inspected secret-like value in diagnostics", () => {
    const result = runPhase6Cli(fixture, {
      migrationDiff: () => false,
      secretLiteralMatches: () => 1,
      routeContractOk: () => false,
    });
    const output = formatPhase6Result(result);
    expect(output).toContain("SECRET_LITERAL_FOUND");
    expect(output).toContain("ROUTE_CONTRACT_FAILED");
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("example.neon.tech");
  });
});
