import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/hermes/app-shell";
import { Providers } from "@/app/providers";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live app shell", () => {
  it("uses the gateway aggregate for the pending-review badge", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: {
          activity: [],
          aggregates: {
            actionsToday: 11,
            pendingHolds: 7,
            blockedSpendCents: 0,
            deniedCount: 0,
            decisionCounts: { allow: 4, hold: 7, deny: 0 },
            trend: [],
          },
        },
      }),
    );

    render(
      <Providers>
        <AppShell>
          <p>Dashboard body</p>
        </AppShell>
      </Providers>,
    );

    expect(await screen.findByText("7 pending review")).toBeInTheDocument();
  });
});
