import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactMocks = vi.hoisted(() => ({
  useActionState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useActionState: reactMocks.useActionState,
  };
});

vi.mock("@/app/login/actions", () => ({
  signInAction: vi.fn(),
  requestMagicLinkAction: vi.fn(),
}));

import { LoginForm } from "@/components/auth/login-form";

describe("LoginForm", () => {
  beforeEach(() => {
    reactMocks.useActionState.mockReset();
  });

  it("renders both the password and magic-link sign-in controls", () => {
    reactMocks.useActionState
      .mockReturnValueOnce([{}, vi.fn(), false])
      .mockReturnValueOnce([{ sent: false }, vi.fn(), false]);

    render(<LoginForm next="/dashboard" />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Magic-link email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeInTheDocument();
  });

  it("shows the generic sent state while keeping the password form available", () => {
    reactMocks.useActionState
      .mockReturnValueOnce([{}, vi.fn(), false])
      .mockReturnValueOnce([{ sent: true }, vi.fn(), false]);

    render(<LoginForm next="/dashboard" />);

    expect(screen.getByRole("status")).toHaveTextContent("If an account exists, check your email.");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
