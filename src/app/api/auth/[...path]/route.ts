import { getAuth } from "@/lib/auth/server";
import { errorResponse } from "@/lib/http";

type AuthRouteContext = { params: Promise<{ path: string[] }> };

function isSignup(request: Request): boolean {
  return new URL(request.url).pathname.includes("/sign-up");
}

function rejectUnsupportedSignup(request: Request): Response | null {
  if (!isSignup(request)) return null;
  const pathname = new URL(request.url).pathname;
  if (request.method === "POST" && pathname.endsWith("/sign-up/email")) return null;
  return Response.json(
    {
      error: {
        code: "SIGNUP_FLOW_REQUIRED",
        message: "Use the HermesPass signup flow to create an account.",
      },
    },
    { status: 404 },
  );
}

export async function GET(request: Request, context: AuthRouteContext) {
  const rejected = rejectUnsupportedSignup(request);
  if (rejected) return rejected;
  try {
    return getAuth().handler().GET(request, context);
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function POST(request: Request, context: AuthRouteContext) {
  const rejected = rejectUnsupportedSignup(request);
  if (rejected) return rejected;
  try {
    return getAuth().handler().POST(request, context);
  } catch (error) {
    return errorResponse(request, error);
  }
}
