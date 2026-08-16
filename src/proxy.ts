import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";

const protectDashboard = process.env["NEON_AUTH_BASE_URL"]
  ? auth.middleware({ loginUrl: "/login" })
  : (request: NextRequest) =>
      NextResponse.redirect(new URL(`/login?next=${request.nextUrl.pathname}`, request.url));

export default function proxy(request: NextRequest) {
  const response = protectDashboard(request);
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
