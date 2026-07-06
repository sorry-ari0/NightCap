import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT || "3001";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH || "";

if (chromiumExecutablePath && !fs.existsSync(chromiumExecutablePath)) {
  throw new Error(`Explicit Chromium executable path does not exist: ${chromiumExecutablePath}`);
}

if (chromiumExecutablePath) {
  process.env.PLAYWRIGHT_EXECUTABLE_PATH = chromiumExecutablePath;
}

const browserLaunchOptions = {
  ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
  args: [
    "--disable-gpu",
    "--disable-features=Vulkan",
    "--no-sandbox",
    "--no-proxy-server",
    "--proxy-server=direct://",
    "--proxy-bypass-list=*"
  ]
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 12_000
  },
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    browserName: "chromium",
    trace: "retain-on-failure",
    launchOptions: browserLaunchOptions
  },
  webServer: {
    command: `GOOGLE_MAPS_API_KEY= REQUIRE_GOOGLE_MAPS=false NODE_ENV=test NIGHTCAP_DATA_PATH=.tmp/nightcap-e2e.json PORT=${e2ePort} npm start`,
    url: `http://127.0.0.1:${e2ePort}/api/health`,
    reuseExistingServer: false,
    timeout: 15_000
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        launchOptions: browserLaunchOptions
      }
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        browserName: "chromium",
        launchOptions: browserLaunchOptions
      }
    }
  ]
});
