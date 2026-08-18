import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("GatewayService approval delivery wiring", () => {
  it("wraps the production decision with post-commit delivery", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/gateway/service.ts"), "utf8");

    expect(source).toContain('from "@/lib/gateway/approval-delivery"');
    expect(source).toMatch(
      /return await deliverCommittedApproval\(\(\) =>\s*decideGatewayRequestWithStore\(request, createPostgresGatewayStore\(\)\)\s*,?\s*\)/,
    );
  });
});
