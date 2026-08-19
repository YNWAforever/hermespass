import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import { AppShell } from "@/components/hermes/app-shell";
import { SiteShell } from "@/components/marketing/site-shell";
import { Providers } from "@/app/providers";

describe("shared Next navigation", () => {
  it("uses resolved language destinations", () => {
    navigation.pathname = "/";
    render(
      <SiteShell>
        <p>content</p>
      </SiteShell>,
    );

    expect(screen.getByRole("link", { name: "繁體" })).toHaveAttribute("href", "/zh-hant");
    expect(screen.getByRole("link", { name: "简体" })).toHaveAttribute("href", "/zh-hans");
  });

  it("marks Pricing active from the current pathname", () => {
    navigation.pathname = "/pricing";
    render(
      <SiteShell>
        <p>content</p>
      </SiteShell>,
    );

    const desktopPricing = screen
      .getAllByRole("link", { name: "Pricing" })
      .find((link) => link.className.includes("px-3"));
    expect(desktopPricing).toHaveClass("bg-surface", "text-foreground");
  });

  it("keeps exact and prefix dashboard matching distinct", () => {
    navigation.pathname = "/dashboard/agents";
    render(
      <Providers>
        <AppShell>
          <p>dashboard content</p>
        </AppShell>
      </Providers>,
    );

    const agentLink = screen.getByRole("link", { name: /Agent Directory/i });
    const overviewLink = screen
      .getAllByRole("link", { name: /^Overview$/i })
      .find((link) => link.className.includes("gap-2.5"));
    expect(agentLink).toHaveClass("bg-sidebar-accent", "text-sidebar-foreground");
    expect(overviewLink).toBeDefined();
    expect(overviewLink).not.toHaveClass("bg-sidebar-accent");
  });
});
