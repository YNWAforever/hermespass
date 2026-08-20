export type KeyEnvironment = "production" | "development" | "preview";

export function databaseUrl(): string {
  const value = process.env["DATABASE_URL"];
  if (!value) throw new Error("DATABASE_URL is required for database-backed requests");
  return value;
}

export function migrationDatabaseUrl(): string {
  const value = process.env["MIGRATION_DATABASE_URL"];
  if (!value) throw new Error("MIGRATION_DATABASE_URL is required for migrations");
  return value;
}

export function neonAuthBaseUrl(): string {
  const value = process.env["NEON_AUTH_BASE_URL"];
  if (!value) throw new Error("NEON_AUTH_BASE_URL is required for Auth-backed requests");
  return value;
}

export function neonAuthCookieSecret(): string {
  const value = process.env["NEON_AUTH_COOKIE_SECRET"];
  if (!value) throw new Error("NEON_AUTH_COOKIE_SECRET is required for Auth-backed requests");
  return value;
}

export function hasNeonAuthConfig(): boolean {
  return Boolean(process.env["NEON_AUTH_BASE_URL"] && process.env["NEON_AUTH_COOKIE_SECRET"]);
}

export function insuranceWebhookSecret(): string {
  const value = process.env["INSURANCE_WEBHOOK_SECRET"];
  if (!value) throw new Error("INSURANCE_WEBHOOK_SECRET is required for insurance operations");
  return value;
}

function requiredProductizationSecret(name: string, message: string): string {
  const value = process.env[name];
  if (!value) throw new Error(message);
  return value;
}

export function reportExportSecret(): string {
  return requiredProductizationSecret(
    "REPORT_EXPORT_SECRET",
    "REPORT_EXPORT_SECRET is required for report exports",
  );
}

export function stripeBillingSecret(): string {
  return requiredProductizationSecret(
    "STRIPE_SECRET_KEY",
    "STRIPE_SECRET_KEY is required for billing operations",
  );
}

export function stripeBillingWebhookSecret(): string {
  return requiredProductizationSecret(
    "STRIPE_BILLING_WEBHOOK_SECRET",
    "STRIPE_BILLING_WEBHOOK_SECRET is required for billing webhooks",
  );
}

export function commsInboundSecret(): string {
  return requiredProductizationSecret(
    "COMMS_INBOUND_SECRET",
    "COMMS_INBOUND_SECRET is required for inbound communications",
  );
}

export function stripeBillingPrice(tier: "starter" | "growth" | "scale"): string {
  const name = `STRIPE_PRICE_${tier.toUpperCase()}`;
  return requiredProductizationSecret(name, `${name} is required for billing checkout`);
}
export function keyEnvironment(): KeyEnvironment {
  const value = process.env["HERMES_KEY_ENVIRONMENT"] ?? process.env["VERCEL_ENV"] ?? "development";
  if (value === "production" || value === "preview" || value === "development") return value;
  throw new Error("HERMES_KEY_ENVIRONMENT must be production, preview, or development");
}

export function hermesKek(): Uint8Array {
  const value = process.env["HERMES_KEK_V1"];
  if (!value) throw new Error("HERMES_KEK_V1 is required for key operations");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32) throw new Error("HERMES_KEK_V1 must decode to 32 bytes");
  return new Uint8Array(decoded);
}

export function issuerOrigin(): string {
  const configured = process.env["HERMES_ISSUER_ORIGIN"];
  if (configured) return configured.replace(/\/$/, "");
  if (process.env["VERCEL_URL"]) return `https://${process.env["VERCEL_URL"]}`;
  return "http://localhost:3000";
}
