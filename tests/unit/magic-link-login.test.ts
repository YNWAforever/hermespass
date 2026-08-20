import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const originalE2eAdapter = process.env["HERMESPASS_E2E_ADAPTER"];
const originalE2eSecret = process.env["HERMESPASS_E2E_AUTH_SECRET"];
const originalVercel = process.env["VERCEL"];

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function repoFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

afterEach(() => {
  restore("HERMESPASS_E2E_ADAPTER", originalE2eAdapter);
  restore("HERMESPASS_E2E_AUTH_SECRET", originalE2eSecret);
  restore("VERCEL", originalVercel);
});

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
    delete process.env["HERMESPASS_E2E_ADAPTER"];
    delete process.env["HERMESPASS_E2E_AUTH_SECRET"];
    delete process.env["VERCEL"];
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

  it("returns a generic sent state through the local E2E adapter without calling Neon Auth", async () => {
    process.env["HERMESPASS_E2E_ADAPTER"] = "1";
    process.env["HERMESPASS_E2E_AUTH_SECRET"] = "a".repeat(43);
    const { requestMagicLinkAction } = await import("@/app/login/actions");
    const data = new FormData();
    data.set("email", "member@example.com");

    await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
      sent: true,
    });
    expect(authMocks.magicLink).not.toHaveBeenCalled();
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

describe("magic-link documentation contract", () => {
  it("documents branch-level Neon Auth magic-link setup without adding app-side auth variables", () => {
    const envExample = repoFile(".env.example");
    const readme = repoFile("README.md");
    const authVariableLines = envExample
      .split(/\r?\n/)
      .filter((line) => line.startsWith("NEON_AUTH_"));

    expect(authVariableLines).toEqual([
      "NEON_AUTH_BASE_URL=https://your-neon-auth-endpoint",
      "NEON_AUTH_COOKIE_SECRET=",
    ]);

    const envText = envExample.toLowerCase();
    const readmeText = readme.toLowerCase();

    expect(envText).toContain("magic-link");
    expect(envText).toContain("branch");
    expect(envText).toContain("/dashboard");
    expect(envText).toContain("organization membership");

    expect(readmeText).toContain("magic-link");
    expect(readmeText).toContain("branch");
    expect(readmeText).toContain("/dashboard");
    expect(readmeText).toContain("organization membership");
  });
});
