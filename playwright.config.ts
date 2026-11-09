/**
 * Playwright end-to-end suite (`npm run test:e2e`).
 *
 * Self-contained: e2e/global-setup.ts starts an isolated PGlite + PostGIS DB
 * (port 5463, ./.pglite-e2e, wiped first), migrates + seeds it, builds the app
 * into .next-e2e and runs `next start -p 3123` against it. The returned
 * teardown stops both processes.
 *
 * Env knobs:
 *   E2E_SKIP_BUILD=1       reuse an existing .next-e2e build
 *   E2E_EXTERNAL_SERVER=1  skip setup; test an already running server (E2E_BASE_URL)
 *
 * Specs share one database, so they run serially (workers: 1). Each spec
 * creates the data it needs (fresh customers, own orders/batches).
 */
// Load .env so test helpers sign session cookies with the same SESSION_SECRET
// the app server uses (`npm run demo` / setup:secrets writes a real one there).
import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: E2E_BASE_URL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "customer",
      testMatch: /customer\/.*\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "merchant",
      testMatch: /merchant\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } },
    },
    {
      name: "api",
      testMatch: /api\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
