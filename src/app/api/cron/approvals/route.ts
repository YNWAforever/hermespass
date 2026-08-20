import { timingSafeEqual } from "node:crypto";

import { runApprovalMaintenance } from "@/lib/approvals/maintenance";
import { errorResponse, jsonError, ok } from "@/lib/http";
import { approvalCronSecret } from "@/lib/telegram/config";

export const dynamic = "force-dynamic";

function exactBearer(candidate: string | null, secret: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(candidate, "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  try {
    if (!exactBearer(request.headers.get("authorization"), approvalCronSecret())) {
      return jsonError(request, "CRON_UNAUTHORIZED", "Cron authentication failed.", 401);
    }
    return ok({ maintenance: await runApprovalMaintenance() });
  } catch (error) {
    return errorResponse(request, error);
  }
}
