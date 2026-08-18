import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationUrl = join(process.cwd(), "drizzle", "0006_scoped_payments.sql");
const hardeningMigrationUrl = join(
  process.cwd(),
  "drizzle",
  "0007_payment_authorization_hardening.sql",
);
const journalUrl = join(process.cwd(), "drizzle", "meta", "_journal.json");
const original0000Url = join(process.cwd(), "drizzle", "0000_low_human_robot.sql");
const original0005Url = join(process.cwd(), "drizzle", "0005_approval_revalidation.sql");

const expectedPrefixTags = [
  "0000_low_human_robot",
  "0001_phase1_security_hardening",
  "0002_policy_gateway",
  "0003_gateway_auth_boundary",
  "0004_approval_operations",
  "0005_approval_revalidation",
];

describe("payment scoped migration contract", () => {
  it("is additive and contains all payment tables", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "mandates"');
    expect(sql).toContain('CREATE TABLE "wallet_cards"');
    expect(sql).toContain('CREATE TABLE "payment_authorizations"');
    expect(sql).toContain('ALTER TABLE "mandates" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "wallet_cards" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "payment_authorizations" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('UNIQUE("agent_id", "nonce")');
    expect(sql).toContain('UNIQUE("rail", "rail_authorization_id")');
    expect(sql).toContain("PAYMENT");
    expect(sql).not.toMatch(/supabase/i);
  });

  it("binds spend aggregates to an authenticated tenant claim", async () => {
    const sql = await readFile(hardeningMigrationUrl, "utf8");

    expect(sql).toContain("hermes_payment_spend_totals");
    expect(sql).toContain("hermes_current_agent_organization_id");
    expect(sql).toContain("payment spend tenant claim required");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.hermes_payment_spend_totals");
  });

  it("does not mutate 0000 through 0005", async () => {
    const original0000 = await readFile(original0000Url, "utf8");
    const original0005 = await readFile(original0005Url, "utf8");
    const journal = JSON.parse(await readFile(journalUrl, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(await readFile(original0000Url, "utf8")).toBe(original0000);
    expect(await readFile(original0005Url, "utf8")).toBe(original0005);
    expect(journal.entries.slice(0, 6).map((entry) => entry.tag)).toEqual(expectedPrefixTags);
    expect(journal.entries).toContainEqual(
      expect.objectContaining({ idx: 6, tag: "0006_scoped_payments" }),
    );
    expect(journal.entries).toContainEqual(
      expect.objectContaining({ idx: 7, tag: "0007_payment_authorization_hardening" }),
    );
  });
});
