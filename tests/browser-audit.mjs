import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 4224;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn("node", ["server/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    NIGHTCAP_DATA_PATH: ".tmp/nightcap-browser.json",
    GOOGLE_MAPS_API_KEY: "",
    REQUIRE_GOOGLE_MAPS: "false"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

const consoleErrors = [];
const failedRequests = [];

try {
  console.log("browser-audit: waiting for server");
  await waitForHealth();
  await auditViewport({ width: 1180, height: 820 }, "desktop");
  await auditViewport({ width: 390, height: 820, isMobile: true }, "mobile");

  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(failedRequests, []);
  console.log("Browser audit passed");
} finally {
  server.kill("SIGTERM");
}

async function auditViewport(viewport, name) {
  console.log(`browser-audit: ${name} context`);
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.isMobile || false,
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(30_000);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${name}: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes(".tile.openstreetmap.org/") && request.failure()?.errorText === "net::ERR_ABORTED") return;
    if (request.url().includes("/api/progress") && request.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${name}: ${request.url()} ${request.failure()?.errorText}`);
  });

  console.log(`browser-audit: ${name} reset`);
  await page.request.post(`${baseUrl}/api/test/reset`, {
    headers: { "x-nightcap-session": `browser-${name}` }
  });
  console.log(`browser-audit: ${name} goto`);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  console.log(`browser-audit: ${name} waiting for venues`);
  try {
    await page.waitForSelector(".venue-card", { state: "attached", timeout: 20_000 });
  await page.waitForSelector(".venue-map", { timeout: 20_000 });
  } catch (error) {
    console.error(`browser-audit: ${name} body text\n${await page.locator("body").innerText().catch(() => "<unavailable>")}`);
    console.error(`browser-audit: ${name} console errors\n${consoleErrors.join("\n") || "<none>"}`);
    throw error;
  }

  console.log(`browser-audit: ${name} invites`);
  await page.locator(".app-tabs").getByRole("button", { name: "Friends" }).click();
  await page.fill('input[placeholder="friend@example.com or +1 555 0100"]', `${name}@example.com`);
  await page.locator(".invite-form").getByRole("button", { name: "Invite" }).click();
  await page.waitForSelector("text=Invite recorded");

  await page.fill('input[placeholder="friend@example.com or +1 555 0100"]', `${name}2@example.com`);
  await page.locator(".invite-form").getByRole("button", { name: "Invite" }).click();
  await page.waitForSelector("text=Group planner");

  console.log(`browser-audit: ${name} rating`);
  await page.locator(".app-tabs").getByRole("button", { name: "Spots" }).click();
  await page.waitForSelector(".venue-card", { state: "attached", timeout: 20_000 });
  await page.locator(".venue-card").first().getByRole("button", { name: "Rate" }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"] textarea').fill(`Browser audit ${name}: useful crowd signal.`);
  await page.click('button:has-text("Save rating")');
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  await page.waitForSelector(`text=Browser audit ${name}: useful crowd signal.`);

  console.log(`browser-audit: ${name} planning`);
  await page.locator(".app-tabs").getByRole("button", { name: "Plan" }).click();
  await page.locator('input[type="range"]').first().evaluate((input) => {
    input.value = "4";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click('button:has-text("Build tonight")');
  await page.waitForSelector(".plan-stop");
  assert.equal(await page.locator(".plan-stop").count(), 3);
  await page.screenshot({ path: `.tmp/nightcap-${name}.png`, fullPage: false, timeout: 15_000 });
  console.log(`browser-audit: ${name} done`);
  await context.close();
  await browser.close();
}

async function launchBrowser() {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      console.log(`browser-audit: launching chromium attempt ${attempt}`);
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
      return await chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        timeout: 60_000,
        args: [
          "--disable-gpu",
          "--disable-features=Vulkan",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--no-proxy-server",
          "--proxy-server=direct://",
          "--proxy-bypass-list=*"
        ]
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  throw lastError;
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Server did not start. Output:\n${serverOutput}`);
}
