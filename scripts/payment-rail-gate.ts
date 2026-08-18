import { execFileSync } from "node:child_process";

const serverConditionFlag = "--payment-rail-server-condition";

// Bun's default resolver intentionally throws for `server-only`. Re-exec this
// small, network-free gate with the React Server condition so it exercises the
// actual factory while preserving the required plain `bun run` invocation.
if (!process.argv.includes(serverConditionFlag)) {
  try {
    execFileSync(
      process.execPath,
      ["--conditions=react-server", import.meta.filename, serverConditionFlag],
      {
        env: { ...process.env, PAYMENT_RAIL: "stripe", STRIPE_SECRET_KEY: "sk_live_never-use" },
        stdio: "inherit",
      },
    );
    process.exitCode = 0;
  } catch (error) {
    process.exitCode =
      error && typeof error === "object" && "status" in error && error.status === 0 ? 0 : 1;
  }
} else {
  const { activePaymentRail } = await import("../src/lib/payments/rails/index");
  process.env["PAYMENT_RAIL"] = "stripe";
  process.env["STRIPE_SECRET_KEY"] = "sk_live_never-use";

  try {
    await activePaymentRail().ensureCardholder({
      organizationId: "00000000-0000-4000-8000-000000000000",
      organizationName: "HermesPass gate",
    });
    process.exitCode = 1;
  } catch (error) {
    const safeCode = error instanceof Error ? error.message : "";
    process.stdout.write(
      safeCode === "PAYMENT_RAIL_TEST_KEY_REQUIRED"
        ? "PAYMENT_RAIL_TEST_KEY_REQUIRED\n"
        : "PAYMENT_RAIL_GATE_FAILED\n",
    );
    process.exitCode = safeCode === "PAYMENT_RAIL_TEST_KEY_REQUIRED" ? 0 : 1;
  }
}
