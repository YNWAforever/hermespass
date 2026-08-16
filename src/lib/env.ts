const BUILD_SAFE_AUTH_URL = "http://127.0.0.1:3000";
const BUILD_SAFE_COOKIE_SECRET = "phase-1-build-cookie-secret-change-me";

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
  return process.env["NEON_AUTH_BASE_URL"] ?? BUILD_SAFE_AUTH_URL;
}

export function neonAuthCookieSecret(): string {
  return process.env["NEON_AUTH_COOKIE_SECRET"] ?? BUILD_SAFE_COOKIE_SECRET;
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
