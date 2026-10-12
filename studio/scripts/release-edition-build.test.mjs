import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildRelease, tauriBuildArguments } from "./release-build.mjs";
import { resolveEditionBuild } from "./edition-build-policy.mjs";

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
const commit = "0123456789abcdef0123456789abcdef01234567";
const captureCommit = async (_command, args) => args[0] === "status" ? "" : commit;

test("release rejects an invalid edition before any command runs", async () => {
  for (const value of ["", "Core", "POCOCK", "full", " core", "core ", "core\n", "roadmap"]) {
    let commands = 0;
    await assert.rejects(buildRelease(manifest, [], {
      environment: { ...signedEnvironment, TICKETRY_EDITION: value },
      log: () => {},
      capture: async () => { commands += 1; return commit; },
      execute: async () => { commands += 1; },
    }), (error) => /TICKETRY_EDITION/.test(error.message)
      && /pocock/.test(error.message)
      && /core/.test(error.message));
    assert.equal(commands, 0, `${JSON.stringify(value)} must not run a command`);
  }
});

test("release logs the resolved edition and its source exactly once", async () => {
  for (const [environment, expected] of [
    [{ ...signedEnvironment }, "Edition: pocock (default)"],
    [{ ...signedEnvironment, TICKETRY_EDITION: "pocock" }, "Edition: pocock (explicit)"],
    [{ ...signedEnvironment, TICKETRY_EDITION: "core" }, "Edition: core (explicit)"],
  ]) {
    const lines = [];
    const stop = new Error("frontend captured");
    await assert.rejects(buildRelease(manifest, [], {
      environment,
      log: (line) => lines.push(line),
      capture: captureCommit,
      execute: async () => { throw stop; },
    }), (error) => error === stop);
    assert.deepEqual(lines.filter((line) => /Edition/i.test(line)), [expected]);
    assert.equal(lines.some((line) => /Roadmap/i.test(line)), false);
  }
});

test("Tauri build arguments add the core Cargo feature before the binary separator", () => {
  const target = manifest.targets[0];
  const core = tauriBuildArguments(manifest, target, {}, {
    allowUnsigned: true,
    editionBuild: resolveEditionBuild({ TICKETRY_EDITION: "core" }),
  });
  const separator = core.indexOf("--", core.indexOf("--config"));
  const features = core.indexOf("--features");
  assert.ok(features !== -1 && features < separator, `--features must precede "--": ${core.join(" ")}`);
  assert.equal(core[features + 1], "edition-core");
  assert.deepEqual(core.slice(-3), ["--", "--bin", "ticketry"]);
  assert.equal(core.some((argument) => argument.includes("--no-default-features")), false);

  const pocock = tauriBuildArguments(manifest, target, {}, {
    allowUnsigned: true,
    editionBuild: resolveEditionBuild({}),
  });
  assert.equal(pocock.some((argument) => argument.includes("edition-core")), false);
  assert.equal(pocock.includes("--features"), false);
});

async function capturedRelease(environment, { allowUnsigned = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ticketry-edition-release-"));
  const fixtureManifest = structuredClone(manifest);
  fixtureManifest.artifacts.frontend.required_outputs = ["dist/edition-release-test.html"];
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
  const lines = [];
  const stop = new Error("Tauri build captured");
  try {
    await assert.rejects(buildRelease(fixtureManifest, [target], {
      root,
      environment,
      log: (line) => lines.push(line),
      allowUnsigned,
      capture: captureCommit,
      execute: async (command, args, label, options) => {
        calls.push({ command, args, label, environment: options?.environment });
        if (label === "frontend build") {
          await write("dist/edition-release-test.html");
          // A later change to the caller's environment cannot re-resolve packaging.
          environment.TICKETRY_EDITION = options.environment.TICKETRY_EDITION === "core" ? "pocock" : "core";
        }
        if (label.startsWith("hook runner build")) {
          await write(`src-tauri/target/${target.rust_target}/release/ticketry-hook`);
        }
        if (label.startsWith("Tauri build")) throw stop;
      },
    }), (error) => error === stop);
    return { calls, lines };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function releaseEnvironment(allowUnsigned) {
  return allowUnsigned
    ? { APPLE_SIGNING_IDENTITY: "partial credentials do not imply signed mode" }
    : { ...signedEnvironment };
}

test("default release builds Pocock in both builds with no edition-core feature anywhere", async () => {
  for (const allowUnsigned of [false, true]) {
    const { calls, lines } = await capturedRelease(releaseEnvironment(allowUnsigned), { allowUnsigned });
    const frontend = calls.find(({ label }) => label === "frontend build");
    const packaging = calls.find(({ label }) => label.startsWith("Tauri build"));
    assert.equal(frontend.environment.TICKETRY_EDITION, "pocock");
    assert.equal(packaging.environment.TICKETRY_EDITION, "pocock");
    for (const { args } of calls) {
      assert.equal(args.some((argument) => argument.includes("edition-core")), false, args.join(" "));
    }
    assert.deepEqual(lines.filter((line) => /Edition/.test(line)), ["Edition: pocock (default)"]);
  }
});

test("core release compiles core into the frontend and Tauri builds with the edition-core feature", async () => {
  for (const allowUnsigned of [false, true]) {
    const environment = { ...releaseEnvironment(allowUnsigned), TICKETRY_EDITION: "core" };
    const { calls, lines } = await capturedRelease(environment, { allowUnsigned });
    const frontend = calls.find(({ label }) => label === "frontend build");
    const hookRunner = calls.find(({ label }) => label.startsWith("hook runner build"));
    const packaging = calls.find(({ label }) => label.startsWith("Tauri build"));
    assert.equal(frontend.environment.TICKETRY_EDITION, "core");
    assert.equal(packaging.environment.TICKETRY_EDITION, "core");
    const features = packaging.args.indexOf("--features");
    assert.ok(features !== -1, packaging.args.join(" "));
    assert.equal(packaging.args[features + 1], "edition-core");
    assert.ok(features < packaging.args.lastIndexOf("--"));
    assert.equal(hookRunner.args.some((argument) => argument.includes("edition-core")), false);
    assert.deepEqual(lines.filter((line) => /Edition/.test(line)), ["Edition: core (explicit)"]);
  }
});

test("signed and unsigned releases resolve the same edition", async () => {
  for (const edition of [undefined, "pocock", "core"]) {
    const resolved = [];
    for (const allowUnsigned of [false, true]) {
      const environment = releaseEnvironment(allowUnsigned);
      if (edition !== undefined) environment.TICKETRY_EDITION = edition;
      const { calls } = await capturedRelease(environment, { allowUnsigned });
      const frontend = calls.find(({ label }) => label === "frontend build");
      const packaging = calls.find(({ label }) => label.startsWith("Tauri build"));
      resolved.push([frontend.environment.TICKETRY_EDITION, packaging.environment.TICKETRY_EDITION]);
    }
    assert.deepEqual(resolved[0], resolved[1]);
    assert.deepEqual(resolved[0], [edition ?? "pocock", edition ?? "pocock"]);
  }
});

test("release builds carry no Roadmap availability switch", async () => {
  const { calls } = await capturedRelease({ ...signedEnvironment });
  for (const { environment } of calls) {
    if (environment) assert.equal("TICKETRY_ROADMAP_ENABLED" in environment, false);
  }
  const source = await readFile(new URL("./release-build.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ROADMAP_ENABLED|roadmap-build-policy|resolveRoadmapAvailability/);
});
