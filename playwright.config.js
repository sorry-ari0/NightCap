import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import { mkdirSync } from "node:fs";

const chromiumConfigHome = "/tmp/nightcap-chromium-config";
process.env.TMPDIR = "/tmp";
process.env.TMP = "/tmp";

try {
  mkdirSync(chromiumConfigHome, { recursive: true });
} catch {
  // Best effort: Chromium can fall back to Playwright's generated profile path.
}

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
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    browserName: "chromium",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    launchOptions: {
      ...browserLaunchOptions,
      env: {
        ...process.env,
        TMPDIR: "/tmp",
        TMP: "/tmp",
        XDG_CONFIG_HOME: chromiumConfigHome
      },
    }
  },
  webServer: {
    command: `GOOGLE_MAPS_API_KEY= REQUIRE_GOOGLE_MAPS=false NODE_ENV=test NIGHTCAP_DATA_PATH=.tmp/nightcap-e2e.json PORT=${e2ePort} npm start`,
    url: `http://127.0.0.1:${e2ePort}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000
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
