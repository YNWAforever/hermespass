import { getAuth } from "@/lib/auth/server";
import { errorResponse } from "@/lib/http";

type AuthRouteContext = { params: Promise<{ path: string[] }> };

function isSignup(request: Request): boolean {
  return new URL(request.url).pathname.includes("/sign-up");
}

function rejectSignup(request: Request): Response | null {
  if (!isSignup(request)) return null;
  return Response.json(
    {
      error: {
        code: "SIGNUP_DISABLED",
        message: "HermesPass accounts are provisioned by an administrator.",
      },
    },
    { status: 404 },
  );
}

export async function GET(request: Request, context: AuthRouteContext) {
  const rejected = rejectSignup(request);
  if (rejected) return rejected;
  try {
    return getAuth().handler().GET(request, context);
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function POST(request: Request, context: AuthRouteContext) {
  const rejected = rejectSignup(request);
  if (rejected) return rejected;
  try {
    return getAuth().handler().POST(request, context);
  } catch (error) {
    return errorResponse(request, error);
  }
}
