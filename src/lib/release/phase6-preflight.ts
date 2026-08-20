export type Phase6CheckCode =
  | "MISSING_REQUIRED_VARIABLE"
  | "UNSAFE_RUNTIME_ROLE"
  | "INVALID_BRANCH_CONFIGURATION"
  | "INVALID_BASE_URL"
  | "MIGRATION_DRIFT"
  | "SECRET_LITERAL_FOUND"
  | "ROUTE_CONTRACT_FAILED";

export type Phase6PreflightResult = {
  ok: boolean;
  checks: Array<{ code: Phase6CheckCode | "OK"; detail: string }>;
};

export type Phase6PreflightInput = {
  requiredVariables: ReadonlyArray<string>;
  presentVariableNames: ReadonlySet<string>;
  runtimeDatabaseUrl: string | null;
  branch: string;
  baseUrl: string;
  migrationDiff: boolean;
  secretLiteralMatches: number;
  routeContractOk: boolean;
};

const SUPPORTED_BRANCHES = new Set(["development", "preview", "production"]);
const RESTRICTED_RUNTIME_ROLE = "hermes_app";

function normalizedNames(names: Iterable<string>): Set<string> {
  return new Set(Array.from(names, (name) => name.trim().toUpperCase()).filter(Boolean));
}

function runtimeRoleCheck(runtimeDatabaseUrl: string | null): {
  code: Phase6CheckCode | "OK";
  detail: string;
} {
  if (!runtimeDatabaseUrl?.trim()) {
    return {
      code: "UNSAFE_RUNTIME_ROLE",
      detail: "Runtime database URL is missing or invalid",
    };
  }

  try {
    const url = new URL(runtimeDatabaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return {
        code: "UNSAFE_RUNTIME_ROLE",
        detail: "Runtime database URL is missing or invalid",
      };
    }

    const role = decodeURIComponent(url.username).trim().toLowerCase();
    if (role !== RESTRICTED_RUNTIME_ROLE) {
      return {
        code: "UNSAFE_RUNTIME_ROLE",
        detail: "Runtime database role must be the restricted application role",
      };
    }
  } catch {
    return {
      code: "UNSAFE_RUNTIME_ROLE",
      detail: "Runtime database URL is missing or invalid",
    };
  }

  return { code: "OK", detail: "Runtime database role is restricted" };
}

function branchCheck(branch: string): {
  code: Phase6CheckCode | "OK";
  detail: string;
} {
  const normalizedBranch = branch.trim().toLowerCase();
  if (!SUPPORTED_BRANCHES.has(normalizedBranch)) {
    return {
      code: "INVALID_BRANCH_CONFIGURATION",
      detail: normalizedBranch
        ? `Unsupported deployment branch: ${normalizedBranch}`
        : "Deployment branch is missing",
    };
  }

  return {
    code: "OK",
    detail: `Deployment branch ${normalizedBranch} is supported`,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1"
  );
}

function baseUrlCheck(baseUrl: string): {
  code: Phase6CheckCode | "OK";
  detail: string;
} {
  try {
    const url = new URL(baseUrl);
    const isHttp = url.protocol === "http:";
    const isHttps = url.protocol === "https:";
    const hasUserinfo = url.username.length > 0 || url.password.length > 0;

    if (hasUserinfo || (!isHttps && !(isHttp && isLoopbackHost(url.hostname)))) {
      return {
        code: "INVALID_BASE_URL",
        detail: "Base URL must use HTTPS outside loopback hosts",
      };
    }
  } catch {
    return {
      code: "INVALID_BASE_URL",
      detail: "Base URL is invalid",
    };
  }

  return { code: "OK", detail: "Base URL uses an allowed transport" };
}

function secretLiteralCheck(secretLiteralMatches: number): {
  code: Phase6CheckCode | "OK";
  detail: string;
} {
  if (!Number.isFinite(secretLiteralMatches) || secretLiteralMatches < 0) {
    return {
      code: "SECRET_LITERAL_FOUND",
      detail: "Secret literal inspection returned an invalid count",
    };
  }

  if (secretLiteralMatches > 0) {
    const noun = secretLiteralMatches === 1 ? "literal" : "literals";
    return {
      code: "SECRET_LITERAL_FOUND",
      detail: `Found ${secretLiteralMatches} secret-like source ${noun}`,
    };
  }

  return { code: "OK", detail: "No secret-like source literals found" };
}

export function runPhase6Preflight(input: Phase6PreflightInput): Phase6PreflightResult {
  const checks: Phase6PreflightResult["checks"] = [];
  const presentNames = normalizedNames(input.presentVariableNames);
  const missingNames = Array.from(
    new Set(
      input.requiredVariables
        .map((name) => name.trim().toUpperCase())
        .filter((name) => name.length > 0 && !presentNames.has(name)),
    ),
  ).sort();

  checks.push(
    missingNames.length === 0
      ? { code: "OK", detail: "All required variable names are present" }
      : {
          code: "MISSING_REQUIRED_VARIABLE",
          detail: `Missing required variables: ${missingNames.join(", ")}`,
        },
  );
  checks.push(runtimeRoleCheck(input.runtimeDatabaseUrl));
  checks.push(branchCheck(input.branch));
  checks.push(baseUrlCheck(input.baseUrl));
  checks.push(
    input.migrationDiff
      ? {
          code: "MIGRATION_DRIFT",
          detail: "Tracked schema has migration drift",
        }
      : { code: "OK", detail: "Tracked schema has no migration drift" },
  );
  checks.push(secretLiteralCheck(input.secretLiteralMatches));
  checks.push(
    input.routeContractOk
      ? { code: "OK", detail: "Route contract fixture passed" }
      : { code: "ROUTE_CONTRACT_FAILED", detail: "Route contract fixture failed" },
  );

  return {
    ok: checks.every(({ code }) => code === "OK"),
    checks,
  };
}
