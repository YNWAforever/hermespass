import { expect, test } from "@playwright/test";

const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";

test.describe("organization onboarding", () => {
  test("creates a workspace as owner without sending role, tier, invite, or organization id", async ({
    page,
  }) => {
    let organizationBody: Record<string, unknown> | null = null;
    await page.route("**/api/auth/sign-up/email", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { token: "session-token", user: { id: "signup-user" } } }),
      });
    });
    await page.route("**/api/orgs", async (route) => {
      organizationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            organization: {
              id: "11111111-1111-4111-8111-111111111111",
              name: "Acme HK",
              slug: "acme-hk",
              tier: "pilot",
              role: "owner",
            },
          },
        }),
      });
    });

    await page.goto(`${NEXT_BASE_URL}/signup`);
    await page.getByLabel("Your name").fill("Owner");
    await page.getByLabel("Work email").fill("owner@example.com");
    await page.getByLabel("Password").fill("correct horse battery staple");
    await page.getByLabel("Organization name").fill("Acme HK");
    await page.getByLabel("Organization slug").fill("acme-hk");
    await page.getByRole("button", { name: "Create workspace" }).click();

    await expect.poll(() => organizationBody).toEqual({ name: "Acme HK", slug: "acme-hk" });
    expect(organizationBody).not.toHaveProperty("role");
    expect(organizationBody).not.toHaveProperty("tier");
    expect(organizationBody).not.toHaveProperty("invite");
    expect(organizationBody).not.toHaveProperty("organizationId");
  });

  test("shows a safe invite denial and never echoes an invite token after acceptance", async ({
    page,
  }) => {
    const token = "A".repeat(43);
    await page.route("**/api/invites/accept", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ token });
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INVITE_EMAIL_MISMATCH",
            message: "This invitation was issued to a different email address.",
            requestId: "e2e-invite",
          },
        }),
      });
    });
    await page.goto(`${NEXT_BASE_URL}/invite/${token}`);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      page.getByText("This invitation was issued to a different email address.", { exact: true }),
    ).toHaveText("This invitation was issued to a different email address.");
    await expect(page.getByText(token)).toHaveCount(0);
  });
});
