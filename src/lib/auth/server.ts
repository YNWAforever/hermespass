import { createNeonAuth } from "@neondatabase/auth/next/server";

import { neonAuthBaseUrl, neonAuthCookieSecret } from "@/lib/env";

export const auth = createNeonAuth({
  baseUrl: neonAuthBaseUrl(),
  cookies: {
    secret: neonAuthCookieSecret(),
    sessionDataTtl: 300,
  },
});

export async function getSessionUser() {
  try {
    const { data } = await auth.getSession();
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
