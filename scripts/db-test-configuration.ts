const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const routingParameters = new Set(["database", "dbname", "host", "hostaddr", "port"]);

export function validateDbTestConfiguration(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const overriddenParameters = [...parsed.searchParams.keys()].filter((key) =>
    routingParameters.has(key.toLowerCase()),
  );

  if (overriddenParameters.length > 0) {
    throw new Error("bun run test:db rejects connection-routing query parameters");
  }

  const host = parsed.hostname;
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));

  if (!localHosts.has(host) || !database.endsWith("_test")) {
    throw new Error(
      "bun run test:db only accepts a disposable local PostgreSQL database ending in _test",
    );
  }
}
