import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("magic-link provider documentation contract", () => {
  it("keeps the current Neon Auth app variables scoped to the existing two values", () => {
    const envExample = readFileSync(join(projectRoot, ".env.example"), "utf8");

    expect(envExample).toContain("NEON_AUTH_BASE_URL=");
    expect(envExample).toContain("NEON_AUTH_COOKIE_SECRET=");
    expect(envExample).not.toMatch(/NEON_AUTH_MAGIC_LINK|MAGIC_LINK_CALLBACK|MAGIC_LINK_EMAIL/i);
  });

  it("documents provider-side magic-link delivery, the fixed dashboard callback, and the membership gate", () => {
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");

    expect(readme).toContain("magic-link");
    expect(readme).toContain("email delivery");
    expect(readme).toMatch(/Neon Console\/Auth configuration must enable magic-link email delivery/i);
    expect(readme).toMatch(/branch used by the deployment/i);
    expect(readme).toMatch(/callback verification returns to `?\/dashboard`?/i);
    expect(readme).toMatch(/successful Auth session still requires HermesPass organization membership/i);
  });
});
