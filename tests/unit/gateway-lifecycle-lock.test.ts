import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "drizzle", "0003_gateway_auth_boundary.sql"),
  "utf8",
);

describe("gateway lifecycle snapshot locking", () => {
  it("uses advisory-before-key order and keeps lookup non-locking", () => {
    expect(migration).toContain("LANGUAGE plpgsql VOLATILE SECURITY DEFINER");
    const lookup = migration.slice(
      migration.indexOf("CREATE FUNCTION public.hermes_gateway_auth_context"),
      migration.indexOf("CREATE FUNCTION public.hermes_set_signature_authenticated_agent_claim"),
    );
    const prelock = migration.slice(
      migration.indexOf("CREATE FUNCTION public.hermes_lock_gateway_signature_agent"),
      migration.indexOf("CREATE FUNCTION public.hermes_set_signature_authenticated_agent_claim"),
    );
    const claim = migration.slice(
      migration.indexOf("CREATE FUNCTION public.hermes_set_signature_authenticated_agent_claim"),
    );

    expect(lookup).not.toContain("FOR SHARE OF key");
    expect(prelock).toContain("public.hermes_lock_gateway_decision(p_agent_id)");
    expect(claim).toContain("public.hermes_lock_gateway_signature_agent");
    expect(claim).toContain("FOR SHARE OF key");
    expect(claim.indexOf("public.hermes_lock_gateway_signature_agent")).toBeLessThan(
      claim.indexOf("FOR SHARE OF key"),
    );
  });
});
