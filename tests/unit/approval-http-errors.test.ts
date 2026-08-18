import { describe, expect, it } from "vitest";

import { errorResponse } from "@/lib/http";

describe("approval and Telegram HTTP errors", () => {
  it.each([
    ["APPROVAL_UNAVAILABLE", 409, "The approval is no longer available."],
    ["APPROVAL_RESOLUTION_INVALID", 400, "The approval resolution is invalid."],
    ["APPROVALS_UNAVAILABLE", 503, "Approvals are temporarily unavailable."],
    ["TELEGRAM_LINK_INVALID", 400, "The Telegram link proof is invalid or unavailable."],
    ["TELEGRAM_LINK_UNAVAILABLE", 503, "Telegram linking is temporarily unavailable."],
  ] as const)("maps %s to the exact safe error envelope", async (code, status, message) => {
    const request = new Request("http://localhost/api/approvals", {
      headers: { "x-request-id": "req-approval-error" },
    });

    const response = errorResponse(request, new Error(code));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message, requestId: "req-approval-error" },
    });
  });
});
