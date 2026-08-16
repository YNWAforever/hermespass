const databaseUrl = process.env["DATABASE_URL_TEST"];

if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required for bun run test:db:smoke");
}

const processHandle = Bun.spawn(
  ["bun", "x", "vitest", "run", "tests/integration/postgres.smoke.test.ts"],
  {
    env: {
      ...process.env,
      DB_SMOKE_REQUIRED: "1",
    },
    stderr: "inherit",
    stdout: "inherit",
  },
);

process.exit(await processHandle.exited);
