import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildRelease } from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(studioRoot, "release", "manifest.v1.json"), "utf8"));
const signedEnvironment = {
  APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
  APPLE_ID: "release@example.test",
  APPLE_PASSWORD: "password",
  APPLE_TEAM_ID: "TEAM",
  TAURI_SIGNING_PRIVATE_KEY: "updater private key",
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "updater key password",
};


test("signed release compiles Roadmap OFF into its first frontend build", async () => {
  const environment = {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
    APPLE_ID: "release@example.test",
    APPLE_PASSWORD: "password",
    APPLE_TEAM_ID: "TEAM",
    TAURI_SIGNING_PRIVATE_KEY: "updater private key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "updater key password",
  };
  const stop = new Error("frontend captured");
  let frontendEnvironment;
  await assert.rejects(buildRelease(manifest, [], {
    environment,
    log: () => {},
    capture: async (_command, args) => args[0] === "status" ? "" : "0123456789abcdef0123456789abcdef01234567",
    execute: async (_command, _args, label, options) => {
      assert.equal(label, "frontend build");
      frontendEnvironment = options?.environment;
      throw stop;
    },
  }), (error) => error === stop);
  assert.equal(frontendEnvironment.TICKETRY_ROADMAP_ENABLED, "false");
});


test("release rejects supplied Roadmap overrides outside literal true and false before building", async () => {
  for (const value of ["", "TRUE", "False", "1", "0", "on", "off", " true", "false ", "true\n"]) {
    let commands = 0;
    await assert.rejects(buildRelease(manifest, [], {
      environment: { ...signedEnvironment, TICKETRY_ROADMAP_ENABLED: value },
      capture: async (_command, args) => args[0] === "status" ? "" : "0123456789abcdef0123456789abcdef01234567",
      execute: async () => { commands += 1; },
    }), /TICKETRY_ROADMAP_ENABLED.*true.*false/);
    assert.equal(commands, 0);
  }
});

async function capturedRelease(environment, { allowUnsigned = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ticketry-roadmap-release-"));
  const fixtureManifest = structuredClone(manifest);
  fixtureManifest.artifacts.frontend.required_outputs = ["dist/roadmap-release-test.html"];
  const target = fixtureManifest.targets[0];
  const write = async (relative, contents = "fixture") => {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  };
  for (const relative of [
    ...fixtureManifest.artifacts.runtime_resources,
    fixtureManifest.release_policy.macos.signing.entitlements,
    fixtureManifest.release_policy.rollback.recovery_document,
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
  ]) {
    await write(relative, await readFile(path.join(studioRoot, relative)));
  }
  const calls = [];
  const stop = new Error("packaging frontend environment captured");
  try {
    await assert.rejects(buildRelease(fixtureManifest, [target], {
      root,
      environment,
      log: () => {},
      allowUnsigned,
      capture: async (_command, args) => args[0] === "status" ? "" : "0123456789abcdef0123456789abcdef01234567",
      execute: async (command, args, label, options) => {
        calls.push({ command, args, label, environment: options?.environment });
        if (label === "frontend build") {
          await write("dist/roadmap-release-test.html");
          // Runtime/source environment changes cannot re-resolve packaging.
          environment.TICKETRY_ROADMAP_ENABLED = options.environment.TICKETRY_ROADMAP_ENABLED === "false" ? "true" : "false";
        }
        if (label.startsWith("hook runner build")) {
          await write(`src-tauri/target/${target.rust_target}/release/ticketry-hook`);
        }
        if (label.startsWith("Tauri build")) throw stop;
      },
    }), (error) => error === stop);
    return calls;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("each release default and override reaches both frontend builds identically", async () => {
  const cases = [
    { allowUnsigned: false, override: undefined, expected: "false" },
    { allowUnsigned: false, override: "true", expected: "true" },
    { allowUnsigned: false, override: "false", expected: "false" },
    { allowUnsigned: true, override: undefined, expected: "true" },
    { allowUnsigned: true, override: "true", expected: "true" },
    { allowUnsigned: true, override: "false", expected: "false" },
  ];
  for (const { allowUnsigned, override, expected } of cases) {
    const environment = allowUnsigned
      ? { APPLE_SIGNING_IDENTITY: "partial credentials do not imply signed mode" }
      : { ...signedEnvironment };
    if (override !== undefined) environment.TICKETRY_ROADMAP_ENABLED = override;
    const calls = await capturedRelease(environment, { allowUnsigned });
    const frontend = calls.find(({ label }) => label === "frontend build");
    const packaging = calls.find(({ label }) => label.startsWith("Tauri build"));
    assert.equal(frontend.environment.TICKETRY_ROADMAP_ENABLED, expected);
    assert.equal(packaging.environment.TICKETRY_ROADMAP_ENABLED, expected);
  }
});
