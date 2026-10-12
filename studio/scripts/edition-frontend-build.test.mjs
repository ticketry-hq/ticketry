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
    lib: { entry: path.resolve("src/shared/config/edition.ts"), formats: ["es"], fileName: () => "edition.mjs" },
  },
});
process.env.TICKETRY_EDITION = process.env.TICKETRY_EDITION === "core" ? "pocock" : "core";
globalThis.__TICKETRY_EDITION__ = process.env.TICKETRY_EDITION;
globalThis.localStorage = { getItem: () => process.env.TICKETRY_EDITION };
const { EDITION, editionHas } = await import(pathToFileURL(path.join(output, "edition.mjs")));
console.log(JSON.stringify({ edition: EDITION, sprintPlanning: editionHas("sprintPlanning") }));
`;

for (const command of ["serve", "build"]) {
  test(`${command} frontend compiles the resolved edition and ignores runtime changes`, async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "ticketry-edition-frontend-"));
    try {
      for (const { override, expected } of [
        { override: undefined, expected: { edition: "pocock", sprintPlanning: false } },
        { override: "pocock", expected: { edition: "pocock", sprintPlanning: false } },
        { override: "core", expected: { edition: "core", sprintPlanning: true } },
      ]) {
        const environment = {
          ...process.env,
          APPLE_SIGNING_IDENTITY: "credentials alone do not select signed release",
          APPLE_ID: "release@example.test", APPLE_PASSWORD: "password", APPLE_TEAM_ID: "TEAM",
          TAURI_SIGNING_PRIVATE_KEY: "updater-key", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "password",
        };
        delete environment.TICKETRY_EDITION;
        if (override !== undefined) environment.TICKETRY_EDITION = override;
        const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", compile, output, command], {
          cwd: studioRoot, env: environment,
        });
        assert.deepEqual(JSON.parse(stdout.trim().split("\n").at(-1)), expected);
      }
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
}

test("direct frontend rejects malformed and empty overrides during configuration", async () => {
  for (const value of ["", "Core", "full", " core"]) {
    await assert.rejects(execFileAsync(process.execPath, ["--input-type=module", "-e", compile, "/unused", "build"], {
      cwd: studioRoot, env: { ...process.env, TICKETRY_EDITION: value },
    }), (error) => /TICKETRY_EDITION.*pocock.*core/.test(error.stderr));
  }
});
