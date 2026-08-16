import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import { EnContactClient } from "@/components/marketing/en-contact-client";
import { EnRoiClient } from "@/components/marketing/en-roi-client";
import { SiteShell } from "@/components/marketing/site-shell";

describe("English marketing interactions", () => {
  it("validates and successfully submits the simulated briefing form", async () => {
    const user = userEvent.setup();
    render(<EnContactClient />);

    await user.click(screen.getByRole("button", { name: "Request briefing" }));
    expect(screen.getByText("Please enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid work email address.")).toBeInTheDocument();
    expect(screen.getByText("Select a region.")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Alex Chan"), "Alex Chan");
    await user.type(screen.getByPlaceholderText("alex@company.com"), "alex@company.com");
    await user.type(screen.getByPlaceholderText("Company Ltd"), "Company Ltd");
    await user.type(
      screen.getByPlaceholderText(/procurement agents raising POs/i),
      "We govern procurement agents.",
    );
    await user.click(screen.getByRole("combobox", { name: "Region" }));
    await user.click(screen.getByRole("option", { name: "Hong Kong SAR" }));
    await user.click(screen.getByRole("button", { name: "Request briefing" }));

    expect(screen.getByRole("heading", { name: "Thanks, Alex." })).toBeInTheDocument();
    expect(screen.getByText(/alex@company.com/i)).toBeInTheDocument();
  });

  it("recalculates annual ROI when an input changes", () => {
    render(<EnRoiClient />);

    expect(screen.getByText("$360,000")).toBeInTheDocument();
    const agents = screen.getAllByRole("spinbutton")[0];
    expect(agents).toBeDefined();
    fireEvent.change(agents!, { target: { value: "50" } });
    expect(screen.getByText("$705,600")).toBeInTheDocument();
  });

  it("opens both desktop mega-menu and mobile navigation destinations", async () => {
    const user = userEvent.setup();
    render(
      <SiteShell>
        <p>content</p>
      </SiteShell>,
    );

    await user.click(screen.getByRole("button", { name: "Platform" }));
    const megaMenuProduct = screen
      .getAllByRole("link", { name: /Product overview/i })
      .find((link) => link.className.includes("group"));
    expect(megaMenuProduct).toHaveAttribute("href", "/product");

    await user.click(screen.getByRole("button", { name: "Toggle navigation" }));
    expect(
      screen
        .getAllByRole("link", { name: "Pricing" })
        .some((link) => link.getAttribute("href") === "/pricing"),
    ).toBe(true);
  });
});
