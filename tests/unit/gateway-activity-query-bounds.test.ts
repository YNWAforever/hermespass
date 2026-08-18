import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("gateway activity aggregate query bounds", () => {
  it("bounds the aggregate scan to the earlier of UTC day start and the 18-hour window", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "gateway", "activity-postgres-store.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /where request\.organization_id = \$\{organizationId\}::uuid\s+and request\.decided_at >= least\(\s*\(date_trunc\('day', now\(\) at time zone 'UTC'\) at time zone 'UTC'\),\s*now\(\) - interval '18 hours'\s*\)/i,
    );
  });
});
