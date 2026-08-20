import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

function runDbTestRunner(databaseUrl: string): string {
  const result = spawnSync("bun", ["scripts/run-db-tests.ts"], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL_TEST: databaseUrl },
    encoding: "utf8",
  });

  return `${result.stdout}${result.stderr}`;
}

describe("run-db-tests configuration", () => {
  it("rejects a host query parameter before running integration tests", () => {
    const output = runDbTestRunner(
      "postgresql://postgres:postgres@localhost:5432/hermespass_test?host=127.0.0.1",
    );

    expect(output).toContain("connection-routing query parameters");
  });

  it("rejects a database query parameter before running integration tests", () => {
    const output = runDbTestRunner(
      "postgresql://postgres:postgres@localhost:5432/hermespass_test?dbname=other_test",
    );

    expect(output).toContain("connection-routing query parameters");
  });
});
