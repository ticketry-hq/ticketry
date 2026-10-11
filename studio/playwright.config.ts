import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { featurePlaywrightProjects } from "./scripts/feature-e2e/playwright-projects.mjs";
import { prepareStackProfile, stackServerEnvironment } from "./scripts/feature-e2e/stackProfile.mjs";

const frontendPort = Number(process.env.TICKETRY_E2E_FRONTEND_PORT ?? 4173);
const adapterPort = process.env.TICKETRY_E2E_ADAPTER_PORT;
const artifactDirectory = process.env.TICKETRY_E2E_ARTIFACT_DIR;
// Workers inherit the runner's directory instead of creating another profile.
if (!process.env.TICKETRY_E2E_DATA_DIR) {
  process.env.TICKETRY_E2E_DATA_DIR = mkdtempSync(join(tmpdir(), "ticketry-e2e-"));
  const ownedDirectory = process.env.TICKETRY_E2E_DATA_DIR;
  // Register before web-server startup, which can fail before global teardown.
  // Workers inherit the directory and never register its cleanup.
  process.once("exit", () => {
    spawnSync("tmux", ["-L", `ticketry-e2e-${basename(ownedDirectory)}`, "kill-server"]);
    rmSync(ownedDirectory, { recursive: true, force: true });
  });
}
const dataDirectory = resolve(process.env.TICKETRY_E2E_DATA_DIR);
process.env.TICKETRY_E2E_DATA_DIR = dataDirectory;
const { providerDirectory } = prepareStackProfile(dataDirectory);
process.env.TICKETRY_E2E_PROVIDER_DIR = providerDirectory;
// The feature runner boots this profile's server ahead of time through its
// warm pool; Playwright then only drives the browser against it.
const externalServer = process.env.TICKETRY_E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: artifactDirectory ? join(artifactDirectory, "artifacts") : "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: artifactDirectory ? join(artifactDirectory, "html") : "playwright-report" }],
    ["json", { outputFile: artifactDirectory ? join(artifactDirectory, "results.json") : "test-results/results.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: featurePlaywrightProjects(resolve(import.meta.dirname, "e2e"), { ...devices["Desktop Chrome"] }),
  webServer: externalServer ? undefined : {
    // Queues behind other e2e servers on this machine so memory stays bounded.
    command: "exec node studio/scripts/with-e2e-stack-slot.mjs node scripts/web-dev.mjs",
    cwd: "..",
    env: stackServerEnvironment({ dataDirectory, providerDirectory, frontendPort, adapterPort }),
    url: `http://127.0.0.1:${frontendPort}`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 600_000,
  },
});
