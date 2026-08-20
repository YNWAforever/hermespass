import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "drizzle", "0012_insurance_lifecycle.sql");
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");

describe("insurance lifecycle migration contract", () => {
  it("appends the insurance migration to the immutable journal", async () => {
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.find((entry) => entry.idx === 12)).toEqual(
      expect.objectContaining({ tag: "0012_insurance_lifecycle" }),
    );
  });

  it("creates tenant tables with forced RLS and current-policy uniqueness", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE public.insurance_policies");
    expect(sql).toContain("CREATE TABLE public.insurance_policy_events");
    expect(sql).toContain("CREATE TABLE public.insurance_commission_ledger");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("insurance_policies_current_agent_key");
    expect(sql).toContain("'binding'");
  });

  it("defines worker/actor boundaries and safe provider-event handling", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("hermes_insurance_quote_insert");
    expect(sql).toContain("hermes_insurance_bind_reserve");
    expect(sql).toContain("hermes_insurance_bind_finalize");
    expect(sql).toContain("hermes_insurance_provider_event");
    expect(sql).toContain("insurance_provider_event_unique");
    expect(sql).toContain("hermes.insurance_worker");
  });
});
