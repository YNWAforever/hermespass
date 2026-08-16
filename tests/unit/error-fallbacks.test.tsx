import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ErrorBoundary from "@/app/error";
import NotFound from "@/app/not-found";
import { ErrorPanel } from "@/components/errors/error-panel";

describe("route fallbacks", () => {
  it("renders the preserved 404 fallback with a home destination", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { level: 1, name: "404" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });

  it("retries route errors through the shared error panel", () => {
    const reset = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<ErrorBoundary error={new Error("test failure")} reset={reset} />);

    expect(screen.getByRole("heading", { name: "This page didn't load" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("supports the root-layout boundary through the same reusable panel", () => {
    const reset = vi.fn();

    render(<ErrorPanel error={new Error("root failure")} reset={reset} />);

    expect(screen.getByText(/Something went wrong on our end/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });
});
