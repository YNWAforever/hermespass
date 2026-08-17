import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AuthRequiredError,
  MembershipRequiredError,
  PermissionDeniedError,
} from "@/lib/auth/errors";
import { errorResponse } from "@/lib/http";

const request = new Request("http://localhost/api/test", {
  headers: { "x-request-id": "req-test" },
});

describe("HTTP error contract", () => {
  it.each([
    [new AuthRequiredError(), 401, "AUTH_REQUIRED"],
    [new MembershipRequiredError(), 403, "MEMBERSHIP_REQUIRED"],
    [new PermissionDeniedError(), 403, "PERMISSION_DENIED"],
  ])("maps %s to a stable envelope", async (error, status, code) => {
    const response = errorResponse(request, error);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: expect.any(String), requestId: "req-test" },
    });
  });

  it("never exposes validation internals beyond field errors", async () => {
    const schema = z.object({ name: z.string().min(2) });
    let error: unknown;
    try {
      schema.parse({ name: "" });
    } catch (caught) {
      error = caught;
    }
    const response = errorResponse(request, error);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request fields are invalid.",
        fieldErrors: { name: ["String must contain at least 2 character(s)"] },
        requestId: "req-test",
      },
    });
  });
});
