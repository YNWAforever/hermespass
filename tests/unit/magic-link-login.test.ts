import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  magicLink: vi.fn(),
  getAuth: vi.fn(() => ({
    signIn: {
      magicLink: authMocks.magicLink,
    },
  })),
}));

vi.mock("@/lib/auth/server", () => ({
  getAuth: authMocks.getAuth,
}));

describe("requestMagicLinkAction", () => {
  beforeEach(() => {
    vi.resetModules();
    authMocks.magicLink.mockReset();
    authMocks.getAuth.mockReset();
    authMocks.getAuth.mockImplementation(() => ({
      signIn: {
        magicLink: authMocks.magicLink,
      },
    }));
  });

  it("rejects blank and malformed email without calling Neon Auth", async () => {
    const { requestMagicLinkAction } = await import("@/app/login/actions");

    for (const email of ["", "not-an-email", "member @example.com"]) {
      const data = new FormData();
      data.set("email", email);

      await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
        sent: false,
        error: "Enter a valid email address.",
      });
    }

    expect(authMocks.magicLink).not.toHaveBeenCalled();
  });

  it("uses the normalized email and fixed dashboard callback", async () => {
    authMocks.magicLink.mockResolvedValueOnce({ data: { status: true }, error: null });
    const { requestMagicLinkAction } = await import("@/app/login/actions");
    const data = new FormData();
    data.set("email", "  Member@Example.com ");
    data.set("next", "//attacker.example");

    await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
      sent: true,
    });
    expect(authMocks.magicLink).toHaveBeenCalledWith({
      email: "Member@Example.com",
      callbackURL: "/dashboard",
    });
  });

  it("does not expose a provider error", async () => {
    authMocks.magicLink.mockResolvedValueOnce({
      data: null,
      error: { code: "MAGIC_LINK_PROVIDER_SECRET", message: "private details" },
    });
    const { requestMagicLinkAction } = await import("@/app/login/actions");
    const data = new FormData();
    data.set("email", "member@example.com");

    await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
      sent: false,
      error: "We couldn't send a sign-in link right now.",
    });
  });

  it("fails safely when Auth configuration is unavailable", async () => {
    authMocks.getAuth.mockImplementationOnce(() => {
      throw new Error("NEON_AUTH_BASE_URL is required for Auth-backed requests");
    });
    const { requestMagicLinkAction } = await import("@/app/login/actions");
    const data = new FormData();
    data.set("email", "member@example.com");

    await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
      sent: false,
      error: "Authentication is not available for this environment.",
    });
  });
});
