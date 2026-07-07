import { expect, test } from "@playwright/test";

async function submitQuickInvite(page, contact) {
  await page.getByPlaceholder("friend@example.com or +1 555 0100").fill(contact);
  await page.locator(".invite-form").getByRole("button", { name: "Invite" }).click();
}

async function seedRankingState(page, sessionId) {
  const headers = { "x-nightcap-session": sessionId };
  await page.request.post("/api/ratings", {
    headers,
    data: {
      venueId: "client-nightmoves",
      canonicalVenueKey: "nightmoves-new-york",
      venueName: "Nightmoves",
      venueAddress: "Williamsburg, Brooklyn, NY",
      venueCity: "New York",
      overallScore: 9.2,
      comment: "Ranking audit: best first stop."
    }
  });
  for (const index of [1, 2, 3]) {
    await page.request.post("/api/invites", {
      headers,
      data: { contact: `ranking-${Date.now()}-${index}@example.com` }
    });
  }
}

async function publishRanking(page, sessionId) {
  const response = await page.request.post("/api/rankings/publish", {
    headers: { "x-nightcap-session": sessionId },
    data: {}
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.request.post("/api/test/reset");
  if (testInfo.title.includes("gates public ranking")) return;
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
  await page.getByRole("button", { name: "Friends" }).click();
  await page.getByRole("button", { name: "Check contacts" }).click();
  await expect(page.getByText("Contacts imported. Recommendations updated.")).toBeVisible();
  await expect(page.locator(".contact-row.active").filter({ hasText: "Maya Chen" })).toBeVisible();
  await submitQuickInvite(page, `friend-${Date.now()}@example.com`);
  await expect(page.getByText("Invite recorded. Unlock progress updated.")).toBeVisible();
  await expect(page.getByText("Friend match scores").locator("..")).toContainText("Unlocked");
});

test("saves venues into a shortlist", async ({ page }) => {
  const firstVenueName = await page.locator(".venue-card h3").first().innerText();
  await page.locator(".venue-card").first().getByLabel("Save venue").click();
  await expect(page.getByText("Saved to your shortlist.")).toBeVisible();
  await expect(page.getByLabel("Saved shortlist").locator(".saved-row")).toHaveCount(1);
  await expect(page.getByLabel("Saved shortlist")).toContainText(firstVenueName);
  await expect(page.getByText("1 saved for later")).toBeVisible();
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
  await page.getByRole("button", { name: "Plan" }).click();
  await page.getByRole("button", { name: "Build tonight" }).click();
  await expect(page.locator(".plan-stop")).toHaveCount(3);
  await page.getByRole("button", { name: "Copy plan" }).click();
  await expect(page.getByText("Plan copied.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("NightCap plan");
});

test("gates public ranking sharing behind three invites", async ({ page }) => {
  const sessionId = `ranking-e2e-${Date.now()}`;
  const lockedPublish = await page.request.post("/api/rankings/publish", {
    headers: { "x-nightcap-session": sessionId },
    data: {}
  });
  expect(lockedPublish.status()).toBe(403);
  expect((await lockedPublish.json()).error).toContain("Invite 3 more friends");

  await seedRankingState(page, sessionId);
  const publishedRanking = await publishRanking(page, sessionId);
  expect(publishedRanking.inviteGate.unlocked).toBe(true);
  expect(publishedRanking.published).toBe(true);
  expect(publishedRanking.shareUrl).toContain("/u/demo/rankings/");

  await page.goto(publishedRanking.shareUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "demo's nightlife ranking" })).toBeVisible();
  await expect(page.getByText("Nightmoves")).toBeVisible();
  await expect(page.getByText("Ranking audit: best first stop.")).toBeVisible();
});
