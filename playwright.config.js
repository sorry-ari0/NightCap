import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
const chromiumConfigHome = "/tmp/nightcap-chromium-config";
process.env.TMPDIR = "/tmp";
process.env.TMP = "/tmp";

try {
  mkdirSync(chromiumConfigHome, { recursive: true });
} catch {
  // Best effort: Chromium can fall back to Playwright's generated profile path.
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL: "http://127.0.0.1:3001",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      env: {
        ...process.env,
        TMPDIR: "/tmp",
        TMP: "/tmp",
        XDG_CONFIG_HOME: chromiumConfigHome
      },
      args: [
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--no-sandbox",
        "--no-proxy-server",
        "--proxy-server=direct://",
        "--proxy-bypass-list=*"
      ]
    }
  },
  webServer: {
    command: "GOOGLE_MAPS_API_KEY= REQUIRE_GOOGLE_MAPS=false NODE_ENV=test NIGHTCAP_DATA_PATH=.tmp/nightcap-e2e.json npm start",
    url: "http://127.0.0.1:3001/api/health",
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] }
    }
  ]
});
