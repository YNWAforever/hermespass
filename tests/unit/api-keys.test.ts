import { describe, expect, it } from "vitest";

import { generateApiKey, hashApiKey } from "@/lib/productization/api-keys";

describe("public API keys", () => {
  it("generates a live key with a stable prefix and only stores its digest", () => {
    const generated = generateApiKey();
    expect(generated.key).toMatch(/^hp_live_[A-Za-z0-9_-]{32,}$/);
    expect(generated.prefix).toHaveLength(12);
    expect(generated.key.startsWith(generated.prefix)).toBe(true);
    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.hash).toBe(hashApiKey(generated.key));
    expect(generated.hash).not.toContain(generated.key);
  });

  it("never generates the same bearer credential twice", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(second.key).not.toBe(first.key);
    expect(second.hash).not.toBe(first.hash);
  });
});
