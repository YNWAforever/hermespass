import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import {
  AuthRequiredError,
  MembershipRequiredError,
  PermissionDeniedError,
} from "@/lib/auth/errors";

export function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? randomUUID();
}

export function jsonError(
  request: Request,
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message, requestId: requestId(request) } }, { status });
}

export function errorResponse(request: Request, error: unknown): Response {
  const id = requestId(request);
  if (error instanceof AuthRequiredError)
    return Response.json(
      { error: { code: error.code, message: "Authentication required.", requestId: id } },
      { status: 401 },
    );
  if (error instanceof MembershipRequiredError)
    return Response.json(
      {
        error: {
          code: error.code,
          message: "HermesPass organization membership required.",
          requestId: id,
        },
      },
      { status: 403 },
    );
  if (error instanceof PermissionDeniedError)
    return Response.json(
      {
        error: {
          code: error.code,
          message: "This organization role cannot perform that action.",
          requestId: id,
        },
      },
      { status: 403 },
    );
  if (error instanceof ZodError)
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request fields are invalid.",
          fieldErrors: error.flatten().fieldErrors,
          requestId: id,
        },
      },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return jsonError(request, "INVALID_JSON", "The request body must contain valid JSON.", 400);

  const message = error instanceof Error ? error.message : "";
  if (message === "INSURANCE_POLICY_EXISTS" || message === "insurance policy already current")
    return jsonError(
      request,
      "INSURANCE_POLICY_EXISTS",
      "An active insurance policy already exists for this agent.",
      409,
    );
  if (message === "INSURANCE_BIND_CONFLICT" || message === "insurance bind already in progress")
    return jsonError(
      request,
      "INSURANCE_BIND_CONFLICT",
      "Another insurance bind is already in progress.",
      409,
    );
  if (message === "INSURANCE_BIND_STALE" || message === "insurance bind attempt is stale")
    return jsonError(request, "INSURANCE_BIND_STALE", "The insurance bind attempt is stale.", 409);
  if (message === "INSURANCE_POLICY_INVALID")
    return jsonError(request, message, "The insurance policy cannot be bound.", 400);
  if (message === "INSURANCE_BIND_UNAVAILABLE")
    return jsonError(request, message, "The insurance binding service is unavailable.", 503);
  if (message === "AGENT_AUTH_FAILED")
    return jsonError(request, message, "Agent authentication failed.", 401);
  if (message === "NONCE_CONFLICT")
    return jsonError(request, message, "This nonce is bound to different signed bytes.", 409);
  if (message === "GATEWAY_UNAVAILABLE")
    return jsonError(request, message, "The gateway is temporarily unavailable.", 503);
  if (message === "APPROVAL_UNAVAILABLE")
    return jsonError(request, message, "The approval is no longer available.", 409);
  if (message === "APPROVAL_RESOLUTION_INVALID")
    return jsonError(request, message, "The approval resolution is invalid.", 400);
  if (message === "APPROVALS_UNAVAILABLE")
    return jsonError(request, message, "Approvals are temporarily unavailable.", 503);
  if (message === "TELEGRAM_LINK_INVALID")
    return jsonError(request, message, "The Telegram link proof is invalid or unavailable.", 400);
  if (message === "TELEGRAM_LINK_UNAVAILABLE")
    return jsonError(request, message, "Telegram linking is temporarily unavailable.", 503);

  if (message === "AGENT_NOT_FOUND")
    return Response.json(
      { error: { code: message, message: "Agent not found.", requestId: id } },
      { status: 404 },
    );
  if (message === "AGENT_NOT_ENROLLABLE")
    return Response.json(
      {
        error: {
          code: message,
          message: "This agent cannot accept a key enrollment.",
          requestId: id,
        },
      },
      { status: 409 },
    );
  if (message === "AGENT_ENROLLMENT_INVALID")
    return Response.json(
      {
        error: {
          code: message,
          message: "The enrollment proof is invalid or unavailable.",
          requestId: id,
        },
      },
      { status: 400 },
    );
  if (message === "POLICY_REVIEWER_INELIGIBLE")
    return Response.json(
      {
        error: {
          code: message,
          message: "The assigned reviewer must be a current owner or administrator.",
          requestId: id,
        },
      },
      { status: 400 },
    );
  if (message === "ENROLLMENT_UNAVAILABLE")
    return jsonError(request, message, "Agent key enrollment is temporarily unavailable.", 503);
  if (message === "POLICY_UPDATE_FAILED")
    return jsonError(request, message, "The agent policy could not be updated.", 500);
  if (message === "ISSUER_NOT_CONFIGURED")
    return Response.json(
      {
        error: {
          code: message,
          message: "The issuer is not configured for this environment.",
          requestId: id,
        },
      },
      { status: 503 },
    );
  if (message === "DATABASE_URL is required for database-backed requests")
    return Response.json(
      {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database configuration is unavailable.",
          requestId: id,
        },
      },
      { status: 503 },
    );
  if (
    message === "NEON_AUTH_BASE_URL is required for Auth-backed requests" ||
    message === "NEON_AUTH_COOKIE_SECRET is required for Auth-backed requests"
  )
    return jsonError(
      request,
      "AUTH_UNAVAILABLE",
      "Authentication configuration is unavailable.",
      503,
    );
  console.error("HermesPass request failed", { requestId: id, error: message || "unknown" });
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: id,
      },
    },
    { status: 500 },
  );
}

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}
