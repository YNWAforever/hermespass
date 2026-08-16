import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import HomePage, { metadata } from "@/app/page";

describe("the root route", () => {
  it("preserves the existing metadata", () => {
    expect(metadata).toMatchObject({
      title: "HermesPass — Know Your Agent Infrastructure for AI Agents",
      description:
        "HermesPass gives every enterprise AI agent a verifiable digital passport, a real-time policy gateway, scoped payment limits and a tamper-evident audit chain.",
      openGraph: {
        title: "HermesPass — Know Your Agent Infrastructure for AI Agents",
        description:
          "Issue verifiable agent passports, gate every tool call in real time, cap agent spend and export regulator-ready audit evidence.",
      },
    });
  });

  it("renders the original hero and primary destinations", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /The digital passport and compliance layer for AI agents/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link", { name: /Book a briefing/i })
        .some((link) => link.getAttribute("href")?.endsWith("/contact")),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: /Explore the live demo/i })
        .some((link) => link.getAttribute("href")?.endsWith("/dashboard")),
    ).toBe(true);
  });
});
