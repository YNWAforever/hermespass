import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import { HermesProvider } from "@/lib/hermes-store";

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("live dashboard polling", () => {
  it("polls both read models every three seconds and Pause stops polling", async () => {
    vi.useFakeTimers();
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
      <HermesProvider>
        <ApprovalsClient />
      </HermesProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    fireEvent.click(screen.getByRole("button", { name: "Pause stream" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    fireEvent.click(screen.getByRole("button", { name: "Resume stream" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});
