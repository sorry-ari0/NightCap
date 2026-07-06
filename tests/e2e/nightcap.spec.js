import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/test/reset");
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

test("loads venues and shows deployment status", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Your night, ranked before it starts." })).toBeVisible();
  await expect(page.getByText(/venues loaded/)).toBeVisible();
  await expect(page.getByText(/Storage:/)).toBeVisible();
  await expect(page.locator(".venue-map")).toBeVisible();
  await expect(page.locator(".venue-card").first()).toBeVisible();
  expect(await page.locator(".venue-card").count()).toBeGreaterThan(0);
});

test("records invites and unlocks social features", async ({ page }) => {
  await page.getByPlaceholder("friend@example.com").fill(`friend-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Invite" }).click({ force: true });
  await expect(page.getByText("Invite recorded. Unlock progress updated.")).toBeVisible();
  await expect(page.getByText("Friend match scores").locator("..")).toContainText("Unlocked");
});

test("rates a venue and refreshes category scores", async ({ page }) => {
  await page.locator(".venue-card").first().getByRole("button", { name: "Rate" }).click();
  await expect(page.locator(".modal")).toBeVisible();
  await page.getByPlaceholder("Line was fast, crowd was fun, drinks were pricey...").fill("Automated audit: solid crowd and easy first stop.");
  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.getByText("Automated audit: solid crowd and easy first stop.")).toBeVisible();
});

test("builds and copies a night plan", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await expect(page.locator(".venue-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Build tonight" }).click();
  await expect(page.locator(".plan-stop")).toHaveCount(3);
  await page.getByRole("button", { name: "Copy plan" }).click();
  await expect(page.getByText("Plan copied.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("NightCap plan");
});
