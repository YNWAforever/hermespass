export const HERMESPASS_E2E_AUTH_COOKIE = "HERMESPASS_E2E_AUTH_COOKIE";
export const HERMESPASS_E2E_USER_ID = "hermespass-e2e-user";

export function isE2eAdapterEnabled(): boolean {
  const secret = process.env["HERMESPASS_E2E_AUTH_SECRET"];
  return (
    process.env["HERMESPASS_E2E_ADAPTER"] === "1" &&
    process.env["VERCEL"] !== "1" &&
    typeof secret === "string" &&
    secret.length >= 32
  );
}

export function isE2eAuthCookie(value: string | undefined): boolean {
  return isE2eAdapterEnabled() && value === process.env["HERMESPASS_E2E_AUTH_SECRET"];
}

export function isE2eUser(userId: string): boolean {
  return isE2eAdapterEnabled() && userId === HERMESPASS_E2E_USER_ID;
}
