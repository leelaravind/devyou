import { defineConfig, devices } from "@playwright/test";

/**
 * DevYou end-to-end, accessibility and visual test suite.
 *
 * This runs against the **deployed** staging Worker, not a local dev server — see
 * `README.md` for why. `baseURL` is therefore the one thing every spec depends on,
 * and it is deliberately the only environment-variable-driven value in this file.
 */
const baseURL = process.env.BASE_URL ?? "https://dev-staging.itisyou.app";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  snapshotPathTemplate: "{testDir}/../screenshots/{projectName}/{arg}{ext}",

  use: {
    baseURL,
    trace: "on-first-retry",
    // A generous but bounded ratio — R-24/R-31 care about the product being fast to
    // use, not about this suite; a flaky pixel diff on a deployed edge site teaches
    // nobody anything. See visual.spec.ts for where this is applied per-assertion.
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
