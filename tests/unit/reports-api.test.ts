import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  buildReportForActor: vi.fn(),
  buildReportForExport: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/reports/service", () => ({
  buildReportForActor: mocks.buildReportForActor,
  buildReportForExport: mocks.buildReportForExport,
}));

const actor = {
  userId: "owner-1",
  email: "owner@example.com",
  name: "Owner",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Acme",
  organizationSlug: "acme-hk",
  role: "owner" as const,
};

const report = {
  framework: "IMDA Agentic AI MGF v1.5",
  frameworkCode: "imda",
  organizationSlug: "acme-hk",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  sections: [],
  exceptions: [],
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireActor.mockResolvedValue(actor);
  mocks.buildReportForActor.mockResolvedValue(report);
  mocks.buildReportForExport.mockResolvedValue(report);
  process.env["REPORT_EXPORT_SECRET"] = "report-secret";
});

describe("compliance report route", () => {
  it("returns actor-scoped JSON with stable query validation", async () => {
    const { GET } = await import("@/app/api/reports/compliance/route");
    const response = await GET(
      new Request(
        "http://localhost/api/reports/compliance?framework=imda&format=json&periodStart=2026-08-01&periodEnd=2026-08-31",
        { headers: { "x-request-id": "req-report" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { report } });
    expect(mocks.buildReportForActor).toHaveBeenCalledWith(
      actor,
      "imda",
      "2026-08-01",
      "2026-08-31",
    );
    expect(mocks.buildReportForExport).not.toHaveBeenCalled();
  });

  it("returns formula-safe CSV with a framework-specific filename", async () => {
    const { GET } = await import("@/app/api/reports/compliance/route");
    const response = await GET(
      new Request(
        "http://localhost/api/reports/compliance?framework=hkma&format=csv&periodStart=2026-08-01&periodEnd=2026-08-31",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("hermespass-hkma-report-");
    expect(await response.text()).toContain("IMDA Agentic AI MGF v1.5");
  });

  it("uses the constant-time export bearer only with an explicit organization UUID", async () => {
    const { GET } = await import("@/app/api/reports/compliance/route");
    const base = "http://localhost/api/reports/compliance?framework=imda&format=json";
    const response = await GET(
      new Request(
        base +
          "&orgId=22222222-2222-4222-8222-222222222222&periodStart=2026-08-01&periodEnd=2026-08-31",
        { headers: { authorization: "Bearer report-secret" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { report } });
    expect(mocks.buildReportForExport).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "imda",
      "2026-08-01",
      "2026-08-31",
    );
    expect(mocks.requireActor).not.toHaveBeenCalled();
  });

  it("rejects impossible calendar dates before invoking the report service", async () => {
    const { GET } = await import("@/app/api/reports/compliance/route");
    const response = await GET(
      new Request(
        "http://localhost/api/reports/compliance?framework=imda&format=json&periodStart=2026-02-30&periodEnd=2026-03-31",
      ),
    );
    expect(response.status).toBe(400);
    expect(mocks.buildReportForActor).not.toHaveBeenCalled();
  });

  it("rejects wrong or ambiguous export credentials and missing org ids", async () => {
    const { GET } = await import("@/app/api/reports/compliance/route");
    const base = "http://localhost/api/reports/compliance?framework=imda&format=json";
    const wrong = await GET(
      new Request(base + "&orgId=22222222-2222-4222-8222-222222222222", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(wrong.status).toBe(401);
    const missingOrg = await GET(
      new Request(base, { headers: { authorization: "Bearer report-secret" } }),
    );
    expect(missingOrg.status).toBe(400);
  });
});
