import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
      args: [
        "--disable-gpu",
        "--disable-features=Vulkan",
        "--no-sandbox",
        "--no-proxy-server",
        "--proxy-server=direct://",
        "--proxy-bypass-list=*"
      ]
    }
  },
  webServer: {
    command: "NODE_ENV=test NIGHTCAP_DATA_PATH=.tmp/nightcap-e2e.json npm start",
    url: "http://127.0.0.1:3001/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
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
