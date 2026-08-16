import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth/server";
import { HERMESPASS_E2E_AUTH_COOKIE, isE2eAuthCookie } from "@/lib/auth/e2e-adapter";
import { hasNeonAuthConfig } from "@/lib/env";

function missingConfigRedirect(request: NextRequest) {
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export default function proxy(request: NextRequest) {
  if (isE2eAuthCookie(request.cookies.get(HERMESPASS_E2E_AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (!hasNeonAuthConfig()) return missingConfigRedirect(request);
  const response = getAuth().middleware({ loginUrl: "/login" })(request);
  if (response instanceof Promise) {
    return response.then((resolved) => preserveDestination(request, resolved));
  }
  return preserveDestination(request, response);
}

function preserveDestination(request: NextRequest, response: Response) {
  const location = response.headers.get("location");
  if (!location) return response;
  const redirect = new URL(location, request.url);
  if (redirect.pathname !== "/login" || redirect.searchParams.has("next")) return response;
  redirect.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(redirect, response.status);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
