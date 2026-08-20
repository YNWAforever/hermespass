import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cronSecret: vi.fn(),
  runMaintenance: vi.fn(),
}));

vi.mock("@/lib/telegram/config", () => ({ approvalCronSecret: mocks.cronSecret }));
vi.mock("@/lib/approvals/maintenance", () => ({
  runApprovalMaintenance: mocks.runMaintenance,
}));

beforeEach(() => {
  mocks.cronSecret.mockReset().mockReturnValue("approval-cron-secret");
  mocks.runMaintenance.mockReset().mockResolvedValue({
    acquired: true,
    expired: 2,
    expiryRaces: 0,
    delivered: 1,
    deliveryFailures: 1,
  });
});

describe("approval maintenance cron route", () => {
  it("rejects a missing or wrong bearer secret before running maintenance", async () => {
    const { GET } = await import("@/app/api/cron/approvals/route");
    const request = new Request("http://localhost/api/cron/approvals", {
      headers: { "x-request-id": "req-cron-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "CRON_UNAUTHORIZED",
        message: "Cron authentication failed.",
        requestId: "req-cron-secret",
      },
    });
    expect(mocks.runMaintenance).not.toHaveBeenCalled();
  });

  it("runs the idempotent maintenance service with the exact bearer secret", async () => {
    const { GET } = await import("@/app/api/cron/approvals/route");
    const request = new Request("http://localhost/api/cron/approvals", {
      headers: { authorization: "Bearer approval-cron-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        maintenance: {
          acquired: true,
          expired: 2,
          expiryRaces: 0,
          delivered: 1,
          deliveryFailures: 1,
        },
      },
    });
    expect(mocks.runMaintenance).toHaveBeenCalledOnce();
  });

  it("registers an hourly Vercel cron schedule", async () => {
    const config = JSON.parse(await readFile(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons).toContainEqual({
      path: "/api/cron/approvals",
      schedule: "0 * * * *",
    });
  });
});
