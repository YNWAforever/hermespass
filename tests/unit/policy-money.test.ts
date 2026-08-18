import { describe, expect, it } from "vitest";

import { parseHkdCents } from "@/lib/policies/money";

describe("parseHkdCents", () => {
  it.each([
    ["0.29", 29],
    ["1.15", 115],
    ["0", 0],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ] as const)("parses %s to exact safe cents", (value, expected) => {
    expect(parseHkdCents(value)).toBe(expected);
  });

  it.each(["", " ", "-1", "+1", ".29", "1.", "1.234", "1e2", "90071992547409.92"])(
    "rejects blank, malformed, or unsafe input %j",
    (value) => {
      expect(parseHkdCents(value)).toBeNull();
    },
  );
});
