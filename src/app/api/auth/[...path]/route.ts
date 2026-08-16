import { auth } from "@/lib/auth/server";

type AuthRouteContext = { params: Promise<{ path: string[] }> };

const handlers = auth.handler();

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
  return rejectSignup(request) ?? handlers.GET(request, context);
}

export async function POST(request: Request, context: AuthRouteContext) {
  return rejectSignup(request) ?? handlers.POST(request, context);
}
