import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  createNeonAuth: vi.fn(() => ({
    getSession: vi.fn(async () => ({
      data: { user: { id: "forged-user", email: "forged@example.com", name: "Forged" } },
    })),
    signIn: { email: vi.fn(async () => ({ error: null })) },
    signOut: vi.fn(async () => undefined),
  })),
  cookieValue: undefined as string | undefined,
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === "HERMESPASS_E2E_AUTH_COOKIE" && authMocks.cookieValue
        ? { value: authMocks.cookieValue }
        : undefined,
    ),
  })),
  redirect: vi.fn(),
}));

vi.mock("@neondatabase/auth/next/server", () => ({
  createNeonAuth: authMocks.createNeonAuth,
}));

vi.mock("next/navigation", () => ({
  redirect: authMocks.redirect,
}));

vi.mock("next/headers", () => ({
  cookies: authMocks.cookies,
}));

const originalAuthUrl = process.env["NEON_AUTH_BASE_URL"];
const originalCookieSecret = process.env["NEON_AUTH_COOKIE_SECRET"];
const originalE2eAdapter = process.env["HERMESPASS_E2E_ADAPTER"];
const originalE2eSecret = process.env["HERMESPASS_E2E_AUTH_SECRET"];
const originalVercel = process.env["VERCEL"];

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.resetModules();
  authMocks.createNeonAuth.mockClear();
  authMocks.redirect.mockClear();
  authMocks.cookieValue = undefined;
  authMocks.cookies.mockClear();
  delete process.env["NEON_AUTH_BASE_URL"];
  delete process.env["NEON_AUTH_COOKIE_SECRET"];
  delete process.env["HERMESPASS_E2E_ADAPTER"];
  delete process.env["HERMESPASS_E2E_AUTH_SECRET"];
  delete process.env["VERCEL"];
});

afterEach(() => {
  restore("NEON_AUTH_BASE_URL", originalAuthUrl);
  restore("NEON_AUTH_COOKIE_SECRET", originalCookieSecret);
  restore("HERMESPASS_E2E_ADAPTER", originalE2eAdapter);
  restore("HERMESPASS_E2E_AUTH_SECRET", originalE2eSecret);
  restore("VERCEL", originalVercel);
});

describe("isolated E2E authentication adapter", () => {
  it("accepts its exact cookie only when the local adapter is explicitly enabled", async () => {
    process.env["HERMESPASS_E2E_ADAPTER"] = "1";
    process.env["HERMESPASS_E2E_AUTH_SECRET"] = "a".repeat(43);
    authMocks.cookieValue = "a".repeat(43);

    const { getSessionUser } = await import("@/lib/auth/server");

    await expect(getSessionUser()).resolves.toEqual({
      id: "hermespass-e2e-user",
      email: "e2e@hermespass.invalid",
      name: "HermesPass E2E",
    });
    expect(authMocks.createNeonAuth).not.toHaveBeenCalled();
  });

  it("rejects the published test cookie when no high-entropy run secret exists", async () => {
    process.env["HERMESPASS_E2E_ADAPTER"] = "1";
    authMocks.cookieValue = "phase1-local-e2e";

    const { getSessionUser } = await import("@/lib/auth/server");

    await expect(getSessionUser()).resolves.toBeNull();
    expect(authMocks.createNeonAuth).not.toHaveBeenCalled();
  });

  it("cannot activate in a Vercel runtime", async () => {
    process.env["HERMESPASS_E2E_ADAPTER"] = "1";
    process.env["HERMESPASS_E2E_AUTH_SECRET"] = "a".repeat(43);
    process.env["VERCEL"] = "1";
    authMocks.cookieValue = "a".repeat(43);

    const { getSessionUser } = await import("@/lib/auth/server");

    await expect(getSessionUser()).resolves.toBeNull();
    expect(authMocks.createNeonAuth).not.toHaveBeenCalled();
  });
});

describe("Auth configuration fail-closed behavior", () => {
  it("does not return build-safe placeholder Auth configuration to request code", async () => {
    const { neonAuthBaseUrl, neonAuthCookieSecret } = await import("@/lib/env");

    expect(() => neonAuthBaseUrl()).toThrow("NEON_AUTH_BASE_URL is required");
    expect(() => neonAuthCookieSecret()).toThrow("NEON_AUTH_COOKIE_SECRET is required");
  });

  it.each([
    [undefined, undefined],
    ["https://auth.example.test", undefined],
    [undefined, "real-cookie-secret"],
  ])(
    "rejects cached or session cookies before constructing the Neon SDK when config is partial",
    async (baseUrl, cookieSecret) => {
      if (baseUrl) process.env["NEON_AUTH_BASE_URL"] = baseUrl;
      if (cookieSecret) process.env["NEON_AUTH_COOKIE_SECRET"] = cookieSecret;

      const { getSessionUser } = await import("@/lib/auth/server");

      await expect(getSessionUser()).resolves.toBeNull();
      expect(authMocks.createNeonAuth).not.toHaveBeenCalled();
    },
  );

  it("rechecks both Auth variables before returning a cached SDK", async () => {
    process.env["NEON_AUTH_BASE_URL"] = "https://auth.example.test";
    process.env["NEON_AUTH_COOKIE_SECRET"] = "real-cookie-secret";
    const { getAuth } = await import("@/lib/auth/server");
    expect(getAuth()).toBeDefined();
    expect(authMocks.createNeonAuth).toHaveBeenCalledOnce();

    delete process.env["NEON_AUTH_COOKIE_SECRET"];

    expect(() => getAuth()).toThrow("NEON_AUTH_COOKIE_SECRET is required");
    expect(authMocks.createNeonAuth).toHaveBeenCalledOnce();
  });
});

describe("post-login destinations", () => {
  it.each([
    "/dashboard\\evil",
    "/dashboard%5cevil",
    "//evil.example/dashboard",
    "/%2f%2fevil.example/dashboard",
    "/dashboard%0d%0aLocation:%20https://evil.example",
    "/pricing",
  ])("falls back to the dashboard for unsafe destination %s", async (destination) => {
    process.env["NEON_AUTH_BASE_URL"] = "https://auth.example.test";
    process.env["NEON_AUTH_COOKIE_SECRET"] = "real-cookie-secret";
    const { signInAction } = await import("@/app/login/actions");
    const data = new FormData();
    data.set("email", "member@example.com");
    data.set("password", "correct horse battery staple");
    data.set("next", destination);

    await signInAction({}, data);

    expect(authMocks.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("preserves a dashboard descendant path and query", async () => {
    process.env["NEON_AUTH_BASE_URL"] = "https://auth.example.test";
    process.env["NEON_AUTH_COOKIE_SECRET"] = "real-cookie-secret";
    const { signInAction } = await import("@/app/login/actions");
    const data = new FormData();
    data.set("email", "member@example.com");
    data.set("password", "correct horse battery staple");
    data.set("next", "/dashboard/agents?tab=revoked");

    await signInAction({}, data);

    expect(authMocks.redirect).toHaveBeenCalledWith("/dashboard/agents?tab=revoked");
  });
});
