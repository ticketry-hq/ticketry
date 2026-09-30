import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
// Reuses the web suite's disposable SQLite profile and web server.
import base from "../playwright.config";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  ...base,
  testDir: ".",
  timeout: 180_000,
  reporter: "list",
  outputDir: resolve(repoRoot, "video/capture-output"),
  use: {
    ...base.use,
    viewport: { width: 1600, height: 900 },
    colorScheme: "dark",
    channel: "chrome",
    video: { mode: "on", size: { width: 1600, height: 900 } },
    trace: "off",
  },
  projects: [{ name: "capture" }],
  webServer: { ...(base.webServer as object), cwd: repoRoot } as never,
});
