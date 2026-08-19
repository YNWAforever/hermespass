import { validateDbTestConfiguration } from "./db-test-configuration";

const databaseUrl = process.env["DATABASE_URL_TEST"];

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for bun run test:db");
}

validateDbTestConfiguration(databaseUrl);

const processHandle = Bun.spawn(
  [
    "bun",
    "x",
    "vitest",
    "run",
    "tests/integration/postgres.integration.test.ts",
    "tests/integration/postgres.policy-gateway.integration.test.ts",
    "tests/integration/postgres.gateway-auth.integration.test.ts",
    "tests/integration/postgres.gateway-store.integration.test.ts",
    "tests/integration/postgres.approval-operations.integration.test.ts",
    "tests/integration/postgres.payments.integration.test.ts",
    "tests/integration/postgres.payment-authorization.integration.test.ts",
    "tests/integration/postgres.insurance.integration.test.ts",
    "tests/integration/postgres.productization.integration.test.ts",
    "tests/integration/postgres.public-verification.integration.test.ts",
    "tests/integration/postgres.reports.integration.test.ts",
    "--maxWorkers=1",
    "--fileParallelism=false",
  ],
  {
    env: {
      ...process.env,
      DB_INTEGRATION_REQUIRED: "1",
    },
    stderr: "inherit",
    stdout: "inherit",
  },
);

process.exit(await processHandle.exited);
