import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/test/reset");
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

async function waitForVenues(page) {
  await expect(page.locator(".venue-map")).toBeVisible();
  await expect(page.locator(".venue-card").first()).toBeVisible();
}

test("loads venues and shows deployment status", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Your night, ranked before it starts." })).toBeVisible();
  await expect(page.getByText(/venues loaded/)).toBeVisible();
  await waitForVenues(page);
});

test("records invites and unlocks social features", async ({ page }) => {
  await waitForVenues(page);
  await page.locator(".app-tabs").getByRole("button", { name: "Friends" }).click();
  await page.getByRole("button", { name: "Check contacts" }).click();
  await expect(page.getByText("Contacts imported. Recommendations updated.")).toBeVisible();
  await expect(page.locator(".contact-row.active").filter({ hasText: "Maya Chen" })).toBeVisible();
  await page.getByPlaceholder("friend@example.com or +1 555 0100").fill(`friend-${Date.now()}@example.com`);
  await page.locator(".invite-form").getByRole("button", { name: "Invite" }).click({ force: true });
  await expect(page.getByText("Invite recorded. Unlock progress updated.")).toBeVisible();
  await expect(page.getByText("Friend match scores").locator("..")).toContainText("Unlocked");
});

test("rates a venue and refreshes category scores", async ({ page }) => {
  await waitForVenues(page);
  await page.locator(".venue-card").first().getByRole("button", { name: "Rate" }).click();
  await expect(page.locator(".modal")).toBeVisible();
  await page.getByPlaceholder("Line was fast, crowd was fun, drinks were pricey...").fill("Automated audit: solid crowd and easy first stop.");
  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.getByText("Automated audit: solid crowd and easy first stop.")).toBeVisible();
});

test("builds and copies a night plan", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await waitForVenues(page);
  await page.locator(".app-tabs").getByRole("button", { name: "Plan" }).click();
  await page.getByRole("button", { name: "Build tonight" }).click();
  await expect(page.locator(".plan-stop")).toHaveCount(3);
  await page.getByRole("button", { name: "Copy plan" }).click();
  await expect(page.getByText("Plan copied.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("NightCap plan");
});

test("saves account, feedback, password reset, and profile picture", async ({ page }) => {
  await page.locator(".app-tabs").getByRole("button", { name: "Account" }).click();
  await page.getByPlaceholder("Your name").fill("NightCap Tester");
  await page.getByPlaceholder("you@example.com").fill(`tester-${Date.now()}@example.com`);
  await page.getByPlaceholder("+1 555 0100").fill("+15550109999");
  await page.locator(".account-form").getByPlaceholder("At least 8 characters").fill("nightcap-password");
  await page.locator(".photo-upload input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgo=", "base64")
  });
  await page.locator(".account-form").getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Account saved.")).toBeVisible();

  await page.locator(".app-tabs").getByRole("button", { name: "Account" }).click();
  await page.getByPlaceholder("Tell us what broke, what felt off, or what should be better.").fill("Account flow audit feedback.");
  await page.locator(".feedback-form").getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Feedback sent.")).toBeVisible();

  await page.getByPlaceholder("Email or phone").fill("+15550109999");
  await page.locator(".password-form").first().getByRole("button", { name: "Send reset" }).click();
  await expect(page.getByText(/Reset code created|Reset link sent/)).toBeVisible();
  await page.locator(".password-form").last().getByPlaceholder("At least 8 characters").fill("nightcap-new-password");
  await page.locator(".password-form").last().getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Password reset.")).toBeVisible();
});
