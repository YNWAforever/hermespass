import { sql } from "drizzle-orm";

import type { Actor } from "@/lib/auth/authorization";
import { withActorTransaction } from "@/lib/auth/authorization";
import { withPublicDatabase, type Transaction } from "@/lib/db";
import { buildHkmaReport } from "@/lib/reports/hkma";
import { buildImdaReport } from "@/lib/reports/imda";
import type { ComplianceReport, ReportFramework, ReportInput } from "@/lib/reports/types";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): Date {
  if (!DATE_ONLY.test(value)) throw new Error("REPORT_PERIOD_INVALID");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("REPORT_PERIOD_INVALID");
  }
  return parsed;
}

function normalizePeriod(
  periodStart: string,
  periodEnd: string,
): {
  start: Date;
  end: Date;
} {
  const start = parseDateOnly(periodStart);
  const endDate = parseDateOnly(periodEnd);
  if (endDate < start) throw new Error("REPORT_PERIOD_INVALID");
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return { start, end: endDate };
}

function asJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("REPORT_UNAVAILABLE");
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error && error.message === "REPORT_UNAVAILABLE") throw error;
      throw new Error("REPORT_UNAVAILABLE");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("REPORT_UNAVAILABLE");
  }
  return value as Record<string, unknown>;
}

function parseInput(value: unknown): ReportInput {
  const raw = asJson(value);
  const agents = Array.isArray(raw["agents"])
    ? raw["agents"].map((agent) => {
        const item = agent as Record<string, unknown>;
        return {
          did: String(item["did"] ?? ""),
          name: String(item["name"] ?? ""),
          risk: String(item["risk"] ?? ""),
          status: String(item["status"] ?? ""),
        };
      })
    : [];
  const decisions = (raw["decisions"] ?? {}) as Record<string, unknown>;
  const approvals = (raw["approvals"] ?? {}) as Record<string, unknown>;
  const finiteCount = (value: unknown) => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
  };
  const median = Number(approvals["medianMinutes"] ?? 0);
  return {
    orgSlug: String(raw["orgSlug"] ?? ""),
    periodStart: String(raw["periodStart"] ?? ""),
    periodEnd: String(raw["periodEnd"] ?? ""),
    chainValid: raw["chainValid"] === true,
    checkedRows: finiteCount(raw["checkedRows"]),
    agents,
    decisions: {
      allow: finiteCount(decisions["allow"]),
      deny: finiteCount(decisions["deny"]),
      hold: finiteCount(decisions["hold"]),
    },
    approvals: {
      resolved: finiteCount(approvals["resolved"]),
      byHuman: finiteCount(approvals["byHuman"]),
      byTimeout: finiteCount(approvals["byTimeout"]),
      medianMinutes: Number.isFinite(median) && median >= 0 ? median : 0,
    },
  };
}

async function readReportInput(
  transaction: Transaction,
  organizationId: string,
  actor: string,
  periodStart: string,
  periodEnd: string,
): Promise<ReportInput> {
  const period = normalizePeriod(periodStart, periodEnd);
  const result = await transaction.execute(sql`
    select public.hermes_report_read_model(
      ${organizationId}::uuid,
      ${period.start}::timestamptz,
      ${period.end}::timestamptz,
      ${actor}
    ) as report
  `);
  const row = result.rows[0] as { report?: unknown } | undefined;
  if (!row?.report) throw new Error("REPORT_UNAVAILABLE");
  return parseInput({
    ...asJson(row.report),
    periodStart,
    periodEnd,
  });
}

function buildReport(input: ReportInput, framework: ReportFramework): ComplianceReport {
  return framework === "imda" ? buildImdaReport(input) : buildHkmaReport(input);
}

export async function buildReportForActor(
  actor: Actor,
  framework: ReportFramework,
  periodStart: string,
  periodEnd: string,
): Promise<ComplianceReport> {
  return withActorTransaction(actor, async (transaction) => {
    const input = await readReportInput(
      transaction,
      actor.organizationId,
      actor.userId,
      periodStart,
      periodEnd,
    );
    return buildReport(input, framework);
  });
}

export async function buildReportForExport(
  organizationId: string,
  framework: ReportFramework,
  periodStart: string,
  periodEnd: string,
): Promise<ComplianceReport> {
  return withPublicDatabase((database) =>
    database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select public.hermes_set_productization_claim('system:report')`,
      );
      const input = await readReportInput(
        transaction,
        organizationId,
        "system:report",
        periodStart,
        periodEnd,
      );
      return buildReport(input, framework);
    }),
  );
}
