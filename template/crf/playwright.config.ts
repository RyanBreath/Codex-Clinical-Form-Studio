import { defineConfig, devices } from "@playwright/test";

const previewPort = process.env.AIRWAYAI_PREVIEW_PORT ?? "4173";
const baseURL = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "output/playwright/test-results",
  reporter: [["list"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js preview --strictPort",
    url: baseURL,
    reuseExistingServer: process.env.AIRWAYAI_RELEASE_SMOKE !== "1",
    timeout: 120_000,
  },
});
