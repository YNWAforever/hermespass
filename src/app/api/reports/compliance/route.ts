import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { reportExportSecret } from "@/lib/env";
import { errorResponse, jsonError, ok } from "@/lib/http";
import { encodeReportCsv } from "@/lib/reports/csv";
import { buildReportForActor, buildReportForExport } from "@/lib/reports/service";
import type { ReportFramework } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

const frameworkSchema = z.enum(["imda", "hkma"]);
const formatSchema = z.enum(["json", "csv"]);
const uuidSchema = z.string().uuid();
const periodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function queryValue(params: URLSearchParams, key: string, schema: z.ZodType<string>): string {
  const value = params.get(key);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      key === "periodStart" || key === "periodEnd"
        ? "REPORT_PERIOD_INVALID"
        : `REPORT_${key.toUpperCase()}_INVALID`,
    );
  }
  return parsed.data;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const framework = queryValue(params, "framework", frameworkSchema) as ReportFramework;
    const format = queryValue(params, "format", formatSchema);
    const authorization = request.headers.get("authorization");

    let report;
    let periodStart: string;
    let periodEnd: string;
    if (authorization) {
      const secret = reportExportSecret();
      if (!constantTimeEquals(authorization, `Bearer ${secret}`)) {
        throw new Error("REPORT_EXPORT_INVALID");
      }
      const organizationId = params.get("orgId");
      if (!organizationId) throw new Error("REPORT_ORG_REQUIRED");
      if (!uuidSchema.safeParse(organizationId).success) {
        throw new Error("REPORT_ORG_INVALID");
      }
      periodStart = queryValue(params, "periodStart", periodSchema);
      periodEnd = queryValue(params, "periodEnd", periodSchema);
      report = await buildReportForExport(organizationId, framework, periodStart, periodEnd);
    } else {
      periodStart = queryValue(params, "periodStart", periodSchema);
      periodEnd = queryValue(params, "periodEnd", periodSchema);
      const actor = await requireActor();
      report = await buildReportForActor(actor, framework, periodStart, periodEnd);
    }

    if (format === "csv") {
      const body = encodeReportCsv(report);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="hermespass-${framework}-report-${periodEnd}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return ok({ report }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(request, "REPORT_REQUEST_INVALID", "The report request is invalid.", 400);
    }
    return errorResponse(request, error);
  }
}
