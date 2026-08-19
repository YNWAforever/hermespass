import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = resolve(root, "drizzle/0013_productization_core.sql");
const publicVerificationMigration = resolve(root, "drizzle/0014_public_verification.sql");
const reportBoundaryMigration = resolve(root, "drizzle/0015_report_read_boundary.sql");
const billingBoundaryMigration = resolve(root, "drizzle/0016_billing_webhook_boundary.sql");
const commsBoundaryMigration = resolve(root, "drizzle/0017_comms_inbound_boundary.sql");
const journal = resolve(root, "drizzle/meta/_journal.json");

describe("productization migration contract", () => {
  it("appends one migration after insurance without rewriting history", () => {
    expect(existsSync(migration)).toBe(true);
    const entries = JSON.parse(readFileSync(journal, "utf8")).entries as Array<{
      idx: number;
      tag: string;
    }>;
    expect(entries.slice(0, 13).map((entry) => entry.tag)).toEqual([
      "0000_low_human_robot",
      "0001_phase1_security_hardening",
      "0002_policy_gateway",
      "0003_gateway_auth_boundary",
      "0004_approval_operations",
      "0005_approval_revalidation",
      "0006_scoped_payments",
      "0007_payment_authorization_hardening",
      "0008_mandate_verified_agent_boundary",
      "0009_card_provisioning_transition",
      "0010_wallet_card_provisioning_attempt",
      "0011_payment_authorization_boundary",
      "0012_insurance_lifecycle",
    ]);
    expect(entries.find((entry) => entry.idx === 13)).toMatchObject({
      idx: 13,
      tag: "0013_productization_core",
    });
    expect(entries.find((entry) => entry.idx === 14)).toMatchObject({
      idx: 14,
      tag: "0014_public_verification",
    });
    expect(entries.find((entry) => entry.idx === 15)).toMatchObject({
      idx: 15,
      tag: "0015_report_read_boundary",
    });
    expect(entries.find((entry) => entry.idx === 16)).toMatchObject({ idx: 16, tag: "0016_billing_webhook_boundary" });
    expect(entries.at(-1)).toMatchObject({ idx: 17, tag: "0017_comms_inbound_boundary" });
  });

  it("adds the restricted report read boundary without rewriting core SQL", () => {
    expect(existsSync(reportBoundaryMigration)).toBe(true);
    const sql = readFileSync(reportBoundaryMigration, "utf8");
    expect(sql).toContain("hermes_report_read_model");
    expect(sql).toContain("hermes_verify_audit_chain");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.hermes_report_read_model");
    expect(sql).not.toMatch(/DROP TABLE|DROP FUNCTION/i);
  });

  it("adds the billing transition boundary without rewriting core SQL", () => {
    expect(existsSync(billingBoundaryMigration)).toBe(true);
    const sql = readFileSync(billingBoundaryMigration, "utf8");
    expect(sql).toContain("hermes_apply_billing_event");
    expect(sql).toContain("hermes_store_stripe_customer");
    expect(sql).toContain("organizations_billing_system_update");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.hermes_apply_billing_event");
    expect(sql).not.toMatch(/DROP TABLE|DROP FUNCTION/i);
  });

  it("adds the communications lookup boundary without rewriting core SQL", () => {
    expect(existsSync(commsBoundaryMigration)).toBe(true);
    const sql = readFileSync(commsBoundaryMigration, "utf8");
    expect(sql).toContain("hermes_find_agent_by_slug");
    expect(sql).toContain("system:comms");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.hermes_find_agent_by_slug");
    expect(sql).not.toMatch(/DROP TABLE|DROP FUNCTION/i);
  });

  it("adds the restricted API-key revoke boundary without rewriting core SQL", () => {
    expect(existsSync(publicVerificationMigration)).toBe(true);
    const sql = readFileSync(publicVerificationMigration, "utf8");
    expect(sql).toContain("hermes_revoke_api_key");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.hermes_revoke_api_key");
    expect(sql).not.toMatch(/DROP TABLE|DROP FUNCTION/i);
  });

  it("keeps the pooled role and RLS fail-closed", () => {
    const sql = readFileSync(migration, "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("hermes_app");
    expect(sql).toContain("hermes_consume_api_key");
    expect(sql).toContain("hermes_accept_org_invite");
    expect(sql).not.toMatch(/BYPASSRLS/i);
    expect(sql).not.toMatch(/supabase|auth\\./i);
  });

  it("defines the productization tables and safe constraints", () => {
    const sql = readFileSync(migration, "utf8");
    for (const table of [
      "org_invites",
      "api_keys",
      "api_usage",
      "billing_events",
      "agent_messages",
    ]) {
      expect(sql).toMatch(new RegExp('CREATE TABLE (?:public\\.)?"?' + table + '"?'));
    }
    expect(sql).toContain("token_hash");
    expect(sql).toContain("payload_digest");
    expect(sql).toContain("organization_id");
  });
});
