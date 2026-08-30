import { defineConfig, devices } from "@playwright/test";

const frontendPort = Number(process.env.TICKETRY_E2E_FRONTEND_PORT ?? 4173);
const adapterPort = process.env.TICKETRY_E2E_ADAPTER_PORT;
const mcpPort = process.env.TICKETRY_E2E_MCP_PORT;

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
    command: "exec node scripts/web-dev.mjs --temp-sqlite",
    cwd: "..",
    env: {
      MUXED_FRONTEND_PORT: String(frontendPort),
      ...(adapterPort ? { TICKETRY_GRAPHQL_ADAPTER_PORT: adapterPort } : {}),
      ...(mcpPort ? { MUXED_DESKTOP_MCP_PORT: mcpPort } : {}),
    },
    url: `http://127.0.0.1:${frontendPort}`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 180_000,
  },
});
