import { createNeonAuth } from "@neondatabase/auth/next/server";
import { cookies } from "next/headers";

import { hasNeonAuthConfig, neonAuthBaseUrl, neonAuthCookieSecret } from "@/lib/env";
import {
  HERMESPASS_E2E_AUTH_COOKIE,
  HERMESPASS_E2E_USER_ID,
  isE2eAuthCookie,
} from "@/lib/auth/e2e-adapter";

let authInstance: ReturnType<typeof createNeonAuth> | undefined;

export function getAuth() {
  const baseUrl = neonAuthBaseUrl();
  const secret = neonAuthCookieSecret();
  authInstance ??= createNeonAuth({
    baseUrl,
    cookies: {
      secret,
      sessionDataTtl: 300,
    },
  });
  return authInstance;
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  if (isE2eAuthCookie(cookieStore.get(HERMESPASS_E2E_AUTH_COOKIE)?.value)) {
    return {
      id: HERMESPASS_E2E_USER_ID,
      email: "e2e@hermespass.invalid",
      name: "HermesPass E2E",
    };
  }
  if (!hasNeonAuthConfig()) return null;
  try {
    const { data } = await getAuth().getSession();
    const user = data?.user;
    if (!user?.id) return null;
    return {
      id: String(user.id),
      email: user.email ?? null,
      name: user.name ?? null,
    };
  } catch {
    return null;
  }
}
