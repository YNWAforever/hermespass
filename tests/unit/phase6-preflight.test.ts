import { describe, expect, it } from "vitest";

import { runPhase6Preflight, type Phase6PreflightInput } from "@/lib/release/phase6-preflight";

const requiredVariables = ["DATABASE_URL", "NEON_AUTH_COOKIE_SECRET", "HERMES_KEK_V1"] as const;

function input(overrides: Partial<Phase6PreflightInput> = {}): Phase6PreflightInput {
  return {
    requiredVariables,
    presentVariableNames: new Set(requiredVariables),
    runtimeDatabaseUrl: "postgresql://hermes_app:super-secret@example.neon.tech/hermespass",
    branch: "development",
    baseUrl: "http://localhost:3000",
    migrationDiff: false,
    secretLiteralMatches: 0,
    routeContractOk: true,
    ...overrides,
  };
}

describe("runPhase6Preflight", () => {
  it("passes when all required names and safe fixture values are present", () => {
    const result = runPhase6Preflight(input());

    expect(result.ok).toBe(true);
    expect(result.checks.every(({ code }) => code === "OK")).toBe(true);
  });

  it("aggregates missing required names into the first check", () => {
    const result = runPhase6Preflight(input({ presentVariableNames: new Set(["DATABASE_URL"]) }));

    expect(result.ok).toBe(false);
    expect(result.checks[0]).toEqual({
      code: "MISSING_REQUIRED_VARIABLE",
      detail: "Missing required variables: HERMES_KEK_V1, NEON_AUTH_COOKIE_SECRET",
    });
  });

  it.each([
    "postgresql://hermes_app:secret@example.neon.tech/hermespass",
    "postgresql://hermes_app@example.neon.tech/hermespass",
  ])("accepts a runtime URL using the restricted hermes_app role: %s", (url) => {
    const result = runPhase6Preflight(input({ runtimeDatabaseUrl: url }));

    expect(result.checks[1]).toEqual({
      code: "OK",
      detail: "Runtime database role is restricted",
    });
  });

  it.each(["owner", "migration", "postgres", "neon_owner"])(
    "rejects a runtime URL using the privileged %s role",
    (role) => {
      const result = runPhase6Preflight(
        input({ runtimeDatabaseUrl: `postgresql://${role}:secret@example.neon.tech/db` }),
      );

      expect(result.ok).toBe(false);
      expect(result.checks[1]?.code).toBe("UNSAFE_RUNTIME_ROLE");
    },
  );

  it.each(["development", "preview", "production"])(
    "accepts the %s deployment branch",
    (branch) => {
      const result = runPhase6Preflight(input({ branch }));

      expect(result.checks[2]).toEqual({
        code: "OK",
        detail: `Deployment branch ${branch} is supported`,
      });
    },
  );

  it("rejects unsupported deployment branches", () => {
    const result = runPhase6Preflight(input({ branch: "staging" }));

    expect(result.checks[2]).toEqual({
      code: "INVALID_BRANCH_CONFIGURATION",
      detail: "Unsupported deployment branch: staging",
    });
  });

  it("accepts localhost over HTTP and production over HTTPS", () => {
    expect(runPhase6Preflight(input({ baseUrl: "http://localhost:3000" })).checks[3]).toEqual({
      code: "OK",
      detail: "Base URL uses an allowed transport",
    });
    expect(runPhase6Preflight(input({ baseUrl: "https://hermespass.asia" })).checks[3]).toEqual({
      code: "OK",
      detail: "Base URL uses an allowed transport",
    });
  });

  it("rejects HTTP URLs that are not loopback hosts", () => {
    const result = runPhase6Preflight(input({ baseUrl: "http://hermespass.asia" }));

    expect(result.checks[3]).toEqual({
      code: "INVALID_BASE_URL",
      detail: "Base URL must use HTTPS outside loopback hosts",
    });
  });

  it("reports migration drift, secret-like literals, and route-contract failures", () => {
    const result = runPhase6Preflight(
      input({ migrationDiff: true, secretLiteralMatches: 1, routeContractOk: false }),
    );

    expect(result.ok).toBe(false);
    expect(result.checks.slice(4)).toEqual([
      { code: "MIGRATION_DRIFT", detail: "Tracked schema has migration drift" },
      { code: "SECRET_LITERAL_FOUND", detail: "Found 1 secret-like source literal" },
      { code: "ROUTE_CONTRACT_FAILED", detail: "Route contract fixture failed" },
    ]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid secret literal count (%s)",
    (secretLiteralMatches) => {
      const result = runPhase6Preflight(input({ secretLiteralMatches }));

      expect(result.checks[5]).toEqual({
        code: "SECRET_LITERAL_FOUND",
        detail: "Secret literal inspection returned an invalid count",
      });
    },
  );

  it("returns checks in the stable contract order", () => {
    const result = runPhase6Preflight(
      input({
        presentVariableNames: new Set(),
        runtimeDatabaseUrl: "postgresql://owner:secret@example.neon.tech/db",
        branch: "staging",
        baseUrl: "http://hermespass.asia",
        migrationDiff: true,
        secretLiteralMatches: 2,
        routeContractOk: false,
      }),
    );

    expect(result.checks.map(({ code }) => code)).toEqual([
      "MISSING_REQUIRED_VARIABLE",
      "UNSAFE_RUNTIME_ROLE",
      "INVALID_BRANCH_CONFIGURATION",
      "INVALID_BASE_URL",
      "MIGRATION_DRIFT",
      "SECRET_LITERAL_FOUND",
      "ROUTE_CONTRACT_FAILED",
    ]);
  });

  it("does not echo URL userinfo or secret text in diagnostics", () => {
    const result = runPhase6Preflight(
      input({
        runtimeDatabaseUrl: "postgresql://owner:do-not-leak@example.neon.tech/db?sslmode=require",
        baseUrl: "https://user:password@hermespass.asia/private",
      }),
    );
    const diagnostics = JSON.stringify(result);

    expect(diagnostics).not.toContain("do-not-leak");
    expect(diagnostics).not.toContain("password");
    expect(diagnostics).not.toContain("example.neon.tech");
    expect(diagnostics).not.toContain("hermespass.asia");
  });
});
