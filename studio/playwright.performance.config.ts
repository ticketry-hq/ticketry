import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

import { SCENARIOS } from "./scripts/performance/options.mjs";
import { RUN_FILES } from "./performance/report/schema.mjs";

/**
 * The profiling suite's own Playwright configuration.
 *
 * It is separate from `playwright.config.ts` on purpose. The acceptance suite
 * boots its own dev-server stack and retains traces and screenshots; a
 * profiling run measures an already-built optimized bundle against a runtime
 * that `scripts/performance/run.mjs` owns, and keeps every diagnostic off
 * unless the run explicitly asked for it. `testDir` also keeps these scenarios
 * out of the ordinary `test:e2e` run, which only ever looks at `./e2e`.
 *
 * Serial by construction: one worker, no retries, no parallelism. A retry
 * would quietly replace a measured failure with a different measurement.
 */
const runDirectory = process.env.TICKETRY_PERF_RUN_DIR ?? path.join(
  "test-results",
  "performance",
  "unattached",
);
const baseURL = process.env.TICKETRY_PERF_BASE_URL ?? "http://127.0.0.1:4273";
const selectedScenarios = (process.env.TICKETRY_PERF_SCENARIOS ?? "idle")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const captures = (process.env.TICKETRY_PERF_CAPTURES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const headed = process.env.TICKETRY_PERF_HEADED === "1";

const scenarioSpecs: Record<string, { spec: string }> = SCENARIOS;
const scenarioMatches = selectedScenarios.map((scenario) => {
  const definition = scenarioSpecs[scenario];
  if (!definition) throw new Error(`unknown profiling scenario ${scenario}`);
  return definition.spec.replace(/^performance\//, "");
});

const viewport = { width: 1440, height: 960 };

export default defineConfig({
  testDir: "./performance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Retention batches and the fifteen-second idle window are legitimately
  // long; each scenario still sets its own tighter budget.
  timeout: 900_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(runDirectory, "playwright-output"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(runDirectory, RUN_FILES.playwrightReport) }],
  ],
  use: {
    baseURL,
    viewport,
    headless: !headed,
    // Diagnostics stay off for baseline timing. `--capture trace` turns the
    // trace on and the run records that it did.
    trace: captures.includes("trace") ? "on" : "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "seed",
      testMatch: /fixtures\/seed\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport },
    },
    {
      name: "chromium",
      dependencies: ["seed"],
      testMatch: scenarioMatches,
      use: { ...devices["Desktop Chrome"], viewport },
    },
    {
      name: "webkit",
      dependencies: ["seed"],
      testMatch: scenarioMatches,
      use: { ...devices["Desktop Safari"], viewport },
    },
  ],
});
