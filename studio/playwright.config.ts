import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const frontendPort = Number(process.env.TICKETRY_E2E_FRONTEND_PORT ?? 4173);
const adapterPort = process.env.TICKETRY_E2E_ADAPTER_PORT;
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

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "exec node scripts/web-dev.mjs",
    cwd: "..",
    env: {
      MUXED_FRONTEND_PORT: String(frontendPort),
      ...(adapterPort ? { TICKETRY_GRAPHQL_ADAPTER_PORT: adapterPort } : {}),
      MUXED_DATA_DIR: dataDirectory,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: `ticketry-e2e-${basename(dataDirectory)}`,
    },
    url: `http://127.0.0.1:${frontendPort}`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 180_000,
  },
});
