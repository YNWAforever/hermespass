import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  runPhase6Preflight,
  type Phase6PreflightInput,
  type Phase6PreflightResult,
} from "../src/lib/release/phase6-preflight";

export type Phase6CliEnvironment = Record<string, string | undefined>;

export type Phase6CliInspection = {
  migrationDiff?: () => boolean;
  secretLiteralMatches?: () => number;
  routeContractOk?: () => boolean;
};

const DEFAULT_REQUIRED_VARIABLES = [
  "DATABASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "HERMES_KEK_V1",
] as const;

const SECRET_LITERAL_PATTERN =
  /sk_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/gi;

function splitNames(value: string | undefined, fallback: Iterable<string>): string[] {
  const names = value
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names && names.length > 0 ? names : Array.from(fallback);
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function defaultMigrationDiff(cwd: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", "--", "drizzle", "src/db/schema.ts"], {
      cwd,
      stdio: "ignore",
    });
    return false;
  } catch {
    return true;
  }
}

function defaultSecretLiteralMatches(cwd: string): number {
  const tracked = runGit(cwd, [
    "ls-files",
    "--",
    "src",
    "ops",
    ".github",
    "drizzle",
    "package.json",
    "README.md",
    "AGENTS.md",
  ])
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);

  let count = 0;
  for (const relativePath of tracked) {
    try {
      const contents = readFileSync(join(cwd, relativePath), "utf8");
      count += contents.match(SECRET_LITERAL_PATTERN)?.length ?? 0;
    } catch {
      // A file that disappears during a local check is not a secret finding.
    }
  }
  return count;
}

function defaultRouteContractOk(cwd: string): boolean {
  try {
    const fixture = readFileSync(join(cwd, "tests/fixtures/routes.ts"), "utf8");
    return (
      fixture.includes("PUBLIC_ROUTES") &&
      fixture.includes("DASHBOARD_ROUTES") &&
      fixture.includes("VISUAL_PARITY_ROUTES") &&
      fixture.includes("/dashboard")
    );
  } catch {
    return false;
  }
}

export function phase6InputFromEnvironment(
  environment: Phase6CliEnvironment,
  inspection: Phase6CliInspection = {},
  cwd = process.cwd(),
): Phase6PreflightInput {
  const requiredVariables = splitNames(
    environment.PHASE6_REQUIRED_VARIABLES,
    DEFAULT_REQUIRED_VARIABLES,
  );
  const presentVariableNames = new Set(
    splitNames(environment.PHASE6_PRESENT_VARIABLES, Object.keys(environment)),
  );
  const routeContractValue = environment.PHASE6_ROUTE_CONTRACT?.trim().toLowerCase();

  return {
    requiredVariables,
    presentVariableNames,
    runtimeDatabaseUrl: environment.PHASE6_DATABASE_URL ?? environment.DATABASE_URL ?? null,
    branch: environment.PHASE6_DEPLOYMENT_BRANCH ?? "development",
    baseUrl: environment.PHASE6_BASE_URL ?? environment.APP_BASE_URL ?? "http://localhost:3000",
    migrationDiff: inspection.migrationDiff?.() ?? defaultMigrationDiff(cwd),
    secretLiteralMatches: inspection.secretLiteralMatches?.() ?? defaultSecretLiteralMatches(cwd),
    routeContractOk:
      inspection.routeContractOk?.() ??
      (routeContractValue === "pass" ||
        (routeContractValue === undefined && defaultRouteContractOk(cwd))),
  };
}

export function runPhase6Cli(
  environment: Phase6CliEnvironment = process.env,
  inspection: Phase6CliInspection = {},
  cwd = process.cwd(),
): Phase6PreflightResult {
  return runPhase6Preflight(phase6InputFromEnvironment(environment, inspection, cwd));
}

export function formatPhase6Result(result: Phase6PreflightResult): string {
  return JSON.stringify(result, null, 2);
}

if (import.meta.main) {
  try {
    const result = runPhase6Cli();
    console.log(formatPhase6Result(result));
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    console.log(
      JSON.stringify(
        {
          ok: false,
          checks: [{ code: "PREFLIGHT_RUNTIME_ERROR", detail: "Local release inspection failed" }],
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}
