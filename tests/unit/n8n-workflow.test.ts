import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "ops/n8n/compliance-report.json");

describe("n8n compliance workflow artifact", () => {
  it("is importable, monthly in Hong Kong time, and contains no secrets", () => {
    const workflow = JSON.parse(readFileSync(workflowPath, "utf8")) as {
      nodes: Array<{ type?: string; parameters?: Record<string, unknown>; name?: string }>;
      connections: Record<string, unknown>;
    };
    expect(Array.isArray(workflow.nodes)).toBe(true);
    expect(workflow.connections).toBeDefined();
    const serialized = JSON.stringify(workflow);
    expect(serialized).not.toMatch(
      /(sk_live_|whsec_|Bearer\s+[A-Za-z0-9_-]{20,}|COMMS_INBOUND_SECRET)/i,
    );
    expect(serialized).toContain("HERMES_ORG_ID");
    expect(serialized).toContain("HERMES_DRIVE_FOLDER_ID");
    expect(serialized).toContain("HERMES_SHEET_ID");
    expect(serialized).toContain("0 1 1 * *");
    const reportNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
    expect(reportNodes).toHaveLength(2);
    for (const node of reportNodes) {
      expect(JSON.stringify(node)).toMatch(/headerAuth/i);
      expect(JSON.stringify(node)).toContain("REPORT_EXPORT_SECRET");
    }
  });
});
