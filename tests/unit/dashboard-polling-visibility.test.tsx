import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import { Providers } from "@/app/providers";

const emptyActivity = {
  activity: [],
  aggregates: {
    actionsToday: 0,
    pendingHolds: 0,
    blockedSpendCents: 0,
    deniedCount: 0,
    decisionCounts: { allow: 0, hold: 0, deny: 0 },
    trend: [],
  },
};

afterEach(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("live dashboard visibility polling", () => {
  it("does not refetch gateway or approval data while the document is hidden", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/gateway/activity") {
        return Response.json({ data: emptyActivity });
      }
      if (String(input) === "/api/approvals") {
        return Response.json({ data: { approvals: [] } });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(
      <Providers>
        <ApprovalsClient />
      </Providers>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
