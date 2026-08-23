import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ReleaseManifestError,
  macosTauriBuildEnvironment,
  macosTauriSigningConfig,
  parseArguments,
  releaseMetadata,
  selectTargets,
  stageTarget,
  tauriBuildArguments,
  validateComponentVersions,
  validateMacOSReleaseEnvironment,
  validateManifest,
  validateReleaseInputs,
  verifyMacOSBundle,
} from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(
  await readFile(path.join(studioRoot, "release", "manifest.v1.json"), "utf8"),
);

test("the release is one Rust desktop artifact with native libghostty", () => {
  assert.equal(manifest.release_version, "0.2.0");
  assert.deepEqual(Object.keys(manifest.artifacts).sort(), [
    "frontend", "runtime_resources", "tauri",
  ]);
  assert.deepEqual(manifest.artifacts.tauri.command.slice(-2), [
    "--features", "native-libghostty",
  ]);
  assert.equal(JSON.stringify(manifest).includes("python"), false);
  assert.equal(JSON.stringify(manifest).includes("sidecar"), false);
  assert.doesNotThrow(() => validateManifest(manifest));
});

test("non-product Cargo binaries require the development-tools feature", async () => {
  const cargoToml = await readFile(path.join(studioRoot, "src-tauri", "Cargo.toml"), "utf8");
  assert.match(cargoToml, /autobins = false/);
  assert.match(
    cargoToml,
    /name = "verify_slice6_copy"[\s\S]*?required-features = \["development-tools"\]/,
  );
});

test("manifest validation requires Rust runtime and release policy declarations", () => {
  const withoutRuntime = structuredClone(manifest);
  withoutRuntime.artifacts.tauri.command = withoutRuntime.artifacts.tauri.command.slice(0, -2);
  assert.throws(() => validateManifest(withoutRuntime), /native-libghostty/);
  const withoutArchitecture = structuredClone(manifest);
  delete withoutArchitecture.targets[0].build_architecture;
  assert.throws(() => validateManifest(withoutArchitecture), ReleaseManifestError);
  const mismatchedVersion = structuredClone(manifest);
  mismatchedVersion.targets[0].compatibility.app_version = "0.1.0";
  assert.throws(() => validateManifest(mismatchedVersion), /app_version must match/);
  const unsignedPolicy = structuredClone(manifest);
  unsignedPolicy.release_policy.macos.notarization.required = false;
  assert.throws(() => validateManifest(unsignedPolicy), /must require macOS notarization/);
});

test("target selection and component versions are exact", () => {
  assert.deepEqual(selectTargets(manifest, "all").map(({ id }) => id), ["macos-aarch64"]);
  assert.throws(() => selectTargets(manifest, "macos-x86_64"), /Unsupported release target/);
  assert.doesNotThrow(() => validateComponentVersions(manifest, {
    tauriVersion: "0.2.0", cargoVersion: "0.2.0",
  }));
  assert.throws(() => validateComponentVersions(manifest, {
    tauriVersion: "0.1.0", cargoVersion: "0.2.0",
  }), /tauriVersion/);
});

test("production signing is required unless unsigned mode is explicit", () => {
  assert.throws(() => validateMacOSReleaseEnvironment({}), /APPLE_SIGNING_IDENTITY/);
  assert.doesNotThrow(() => validateMacOSReleaseEnvironment({}, { allowUnsigned: true }));
  const signed = {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
    APPLE_ID: "release@example.test",
    APPLE_PASSWORD: "password",
    APPLE_TEAM_ID: "TEAM",
  };
  assert.doesNotThrow(() => validateMacOSReleaseEnvironment(signed));
  assert.throws(
    () => validateMacOSReleaseEnvironment(signed, { allowUnsigned: true }),
    /--allow-unsigned cannot be used/,
  );
});

test("Tauri signing configuration follows the manifest", () => {
  const signed = JSON.parse(macosTauriSigningConfig(manifest, {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
  }));
  assert.deepEqual(signed.bundle.macOS, {
    signingIdentity: "Developer ID Application: Example",
    hardenedRuntime: true,
    entitlements: "entitlements.plist",
  });
  assert.deepEqual(
    macosTauriBuildEnvironment({ EXISTING: "yes" }, { allowUnsigned: true }),
    { EXISTING: "yes", CI: "true" },
  );
});

test("Tauri builds only the shipping desktop binary", () => {
  const args = tauriBuildArguments(manifest, manifest.targets[0], {}, {
    allowUnsigned: true,
  });
  assert.deepEqual(args.slice(-3), ["--", "--bin", "ticketry"]);
});

test("release arguments preserve validation and unsigned controls", () => {
  assert.deepEqual(parseArguments(["--target", "macos-aarch64", "--validate"]), {
    target: "macos-aarch64", validateOnly: true, allowUnsigned: false,
  });
  assert.equal(parseArguments(["--allow-unsigned"]).allowUnsigned, true);
  assert.throws(() => parseArguments(["--unknown"]), /Unknown release build option/);
});

test("repository release inputs validate without a packaged service", async () => {
  await assert.doesNotReject(validateReleaseInputs(manifest, studioRoot, {
    includeFrontendOutputs: false,
  }));
});

test("unsigned bundle verification checks only the app and hook binaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ticketry-release-"));
  const app = path.join(root, "Ticketry.app");
  const resources = path.join(app, "Contents", "Resources");
  const executable = path.join(app, "Contents", "MacOS", "ticketry");
  const hook = path.join(app, "Contents", "MacOS", "ticketry-hook");
  await Promise.all([
    mkdir(path.dirname(executable), { recursive: true }),
    mkdir(path.join(resources, "terminfo", "78"), { recursive: true }),
    mkdir(path.join(resources, "ghostty", "shell-integration", "zsh"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(executable, ""),
    writeFile(hook, ""),
    writeFile(path.join(resources, "terminfo", "78", "xterm-ghostty"), ""),
    writeFile(path.join(resources, "ghostty", "shell-integration", "zsh", "ghostty-integration"), ""),
  ]);
  const calls = [];
  try {
    await verifyMacOSBundle(manifest, manifest.targets[0], { app }, {
      allowUnsigned: true,
      capture: async (command, args, label) => {
        calls.push([command, ...args, label]);
        return "arm64";
      },
      execute: async (command, args, label) => calls.push([command, ...args, label]),
      log: () => {},
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(calls.filter(([command]) => command === "lipo").length, 2);
  assert.equal(calls.some((call) => call.join(" ").includes("sidecar")), false);
});

test("bundle verification rejects stale helpers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ticketry-release-stale-"));
  const app = path.join(root, "Ticketry.app");
  const resources = path.join(app, "Contents", "Resources");
  const executableDirectory = path.join(app, "Contents", "MacOS");
  await Promise.all([
    mkdir(executableDirectory, { recursive: true }),
    mkdir(path.join(resources, "terminfo", "78"), { recursive: true }),
    mkdir(path.join(resources, "ghostty", "shell-integration", "zsh"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(executableDirectory, "ticketry"), ""),
    writeFile(path.join(executableDirectory, "ticketry-hook"), ""),
    writeFile(path.join(executableDirectory, "verify_slice6_copy"), ""),
    writeFile(path.join(resources, "terminfo", "78", "xterm-ghostty"), ""),
    writeFile(path.join(resources, "ghostty", "shell-integration", "zsh", "ghostty-integration"), ""),
  ]);
  try {
    await assert.rejects(
      verifyMacOSBundle(manifest, manifest.targets[0], { app }),
      /unexpected helpers: verify_slice6_copy/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("staging emits app, installer, and Rust runtime metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ticketry-stage-"));
  const app = path.join(root, "source", "Ticketry.app");
  const dmg = path.join(root, "source", "Ticketry_0.2.0_aarch64.dmg");
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, "marker"), "app");
  await writeFile(dmg, "dmg");
  try {
    const destination = await stageTarget(
      manifest, manifest.targets[0], { app, dmg }, { allowUnsigned: true, root },
    );
    const metadata = JSON.parse(
      await readFile(path.join(destination, "release-metadata.json"), "utf8"),
    );
    assert.deepEqual(metadata.components, {
      app_version: "0.2.0",
      runtime_protocol: "1",
      database_schema: "forward-migrations-required",
    });
    assert.equal(metadata.signed, false);
    assert.equal(metadata.notarized, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release metadata contains no retired service component", () => {
  const metadata = releaseMetadata(manifest, manifest.targets[0]);
  assert.equal("sidecar_version" in metadata.components, false);
  assert.equal(metadata.release_version, "0.2.0");
});
