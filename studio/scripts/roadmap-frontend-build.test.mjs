import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const compile = `
import { build, loadConfigFromFile } from "vite";
import { pathToFileURL } from "node:url";
import path from "node:path";
const [output, command] = process.argv.slice(1);
const { config } = await loadConfigFromFile(
  { command, mode: command === "serve" ? "development" : "production" },
  path.resolve("vite.config.ts"),
);
await build({
  ...config, configFile: false, logLevel: "silent",
  build: {
    outDir: output, emptyOutDir: true,
    lib: { entry: path.resolve("src/shared/config/roadmapAvailability.ts"), formats: ["es"], fileName: () => "roadmap.mjs" },
  },
});
process.env.TICKETRY_ROADMAP_ENABLED = process.env.TICKETRY_ROADMAP_ENABLED === "false" ? "true" : "false";
globalThis.__TICKETRY_ROADMAP_ENABLED__ = true;
globalThis.localStorage = { getItem: () => "true" };
const { ROADMAP_ENABLED } = await import(pathToFileURL(path.join(output, "roadmap.mjs")));
console.log(JSON.stringify({ enabled: ROADMAP_ENABLED, type: typeof ROADMAP_ENABLED }));
`;

for (const command of ["serve", "build"]) {
  test(`${command} frontend compiles strict availability and ignores runtime changes`, async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "ticketry-roadmap-frontend-"));
    try {
      for (const { override, expected } of [
        { override: undefined, expected: true },
        { override: "true", expected: true },
        { override: "false", expected: false },
      ]) {
        const environment = {
          ...process.env,
          APPLE_SIGNING_IDENTITY: "credentials alone do not select signed release",
          APPLE_ID: "release@example.test", APPLE_PASSWORD: "password", APPLE_TEAM_ID: "TEAM",
          TAURI_SIGNING_PRIVATE_KEY: "updater-key", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "password",
        };
        delete environment.TICKETRY_ROADMAP_ENABLED;
        if (override !== undefined) environment.TICKETRY_ROADMAP_ENABLED = override;
        const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", compile, output, command], {
          cwd: studioRoot, env: environment,
        });
        assert.deepEqual(JSON.parse(stdout.trim().split("\n").at(-1)), { enabled: expected, type: "boolean" });
      }
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
}

test("direct frontend rejects malformed and empty overrides during configuration", async () => {
  for (const value of ["", "TRUE", "false ", "0"]) {
    await assert.rejects(execFileAsync(process.execPath, ["--input-type=module", "-e", compile, "/unused", "build"], {
      cwd: studioRoot, env: { ...process.env, TICKETRY_ROADMAP_ENABLED: value },
    }), (error) => /TICKETRY_ROADMAP_ENABLED.*true.*false/.test(error.stderr));
  }
});
