import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const frontendPort = 4173;
const backendPort = 18787;

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
      MUXED_WEB_BACKEND_PORT: String(backendPort),
      WORKTRACKER_DISABLE_AUTH: "true",
      // Task worktrees cut by the suite stay in the OS temp directory rather
      // than the developer's profile, the same promise the temporary SQLite
      // profile already makes.
      MUXED_WORKTREES_DIR: join(tmpdir(), "ticketry-e2e-worktrees"),
      // Commit and pull-request text must not depend on whichever headless CLI
      // the developer happens to have installed: every generator is pointed at
      // a path that does not exist, so the deterministic template writes the
      // message and no real model is ever spawned by a test.
      MUXED_APPROVED_CLAUDE_PATH: "/nonexistent/claude",
      MUXED_APPROVED_CODEX_PATH: "/nonexistent/codex",
      MUXED_APPROVED_GEMINI_PATH: "/nonexistent/gemini",
      MUXED_APPROVED_OPENCODE_PATH: "/nonexistent/opencode",
    },
    url: `http://127.0.0.1:${frontendPort}`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 180_000,
  },
});
