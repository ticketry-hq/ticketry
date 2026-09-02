import { defineConfig, devices } from "@playwright/test";

// Local reproduction config: points at an already-running web-dev stack
// (scripts/web-dev.mjs --temp-sqlite with MUXED_FRONTEND_PORT=4173) instead of
// booting its own. Delete after debugging.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
