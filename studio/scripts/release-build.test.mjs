import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ReleaseManifestError,
  macosTauriBuildEnvironment,
  macosTauriSigningConfig,
  parseArguments,
  releaseMetadata,
  selectTargets,
  stageTarget,
  validateComponentVersions,
  validateMacOSReleaseEnvironment,
  validateManifest,
  validateReleaseInputs,
  verifyMacOSBundle,
} from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(studioRoot, "release", "manifest.v1.json"), "utf8"));

test("all resolves to the single supported macOS target", () => {
  assert.deepEqual(selectTargets(manifest, "all").map(({ id }) => id), ["macos-aarch64"]);
  assert.equal(manifest.targets.every(({ platform }) => platform === "macos"), true);
});

test("an unsupported target fails before a build can start", () => {
  assert.throws(
    () => selectTargets(manifest, "macos-x86_64"),
    /Unsupported release target "macos-x86_64".*macos-aarch64/,
  );
});

test("manifest validation requires sidecar and dependency policy declarations", () => {
  const incomplete = structuredClone(manifest);
  delete incomplete.targets[0].sidecar.target_triple;
  assert.throws(() => validateManifest(incomplete), ReleaseManifestError);

  const missingPolicy = structuredClone(manifest);
  delete missingPolicy.artifacts.sidecar.dependency_policy.python_lock;
  assert.throws(() => validateManifest(missingPolicy), ReleaseManifestError);

  const missingBuildArchitecture = structuredClone(manifest);
  delete missingBuildArchitecture.targets[0].build_architecture;
  assert.throws(() => validateManifest(missingBuildArchitecture), ReleaseManifestError);

  const mismatchedSidecarVersion = structuredClone(manifest);
  mismatchedSidecarVersion.targets[0].compatibility.sidecar_version = "0.0.9";
  assert.throws(() => validateManifest(mismatchedSidecarVersion), /sidecar_version must match release_version/);

  const unsignedBundle = structuredClone(manifest);
  unsignedBundle.release_policy.macos.notarization.required = false;
  assert.throws(() => validateManifest(unsignedBundle), /must require macOS notarization/);
});

test("production builds require signing and one supported notarization authentication", () => {
  assert.throws(() => validateMacOSReleaseEnvironment({}), /APPLE_SIGNING_IDENTITY/);
  assert.doesNotThrow(() => validateMacOSReleaseEnvironment({
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example, Inc.",
    APPLE_ID: "releases@example.test",
    APPLE_PASSWORD: "app-specific-password",
    APPLE_TEAM_ID: "TEAMID",
  }));
  assert.doesNotThrow(() => validateMacOSReleaseEnvironment({
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example, Inc.",
    APPLE_API_KEY: "KEYID",
    APPLE_API_ISSUER: "ISSUERID",
    APPLE_API_KEY_PATH: "/tmp/AuthKey_KEYID.p8",
  }));

  assert.doesNotThrow(() => validateMacOSReleaseEnvironment({}, { allowUnsigned: true }));
  assert.throws(
    () => validateMacOSReleaseEnvironment({
      APPLE_SIGNING_IDENTITY: "Developer ID Application: Example, Inc.",
      APPLE_ID: "releases@example.test",
      APPLE_PASSWORD: "app-specific-password",
      APPLE_TEAM_ID: "TEAMID",
    }, { allowUnsigned: true }),
    /--allow-unsigned cannot be used when complete macOS signing and notarization credentials are present/,
  );
});

test("Tauri receives the manifest's signing identity and hardened runtime policy", () => {
  const config = JSON.parse(macosTauriSigningConfig(manifest, {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example, Inc.",
  }));
  assert.deepEqual(config.bundle.macOS, {
    signingIdentity: "Developer ID Application: Example, Inc.",
    hardenedRuntime: true,
    entitlements: "entitlements.plist",
  });

  const unsignedConfig = JSON.parse(macosTauriSigningConfig(manifest, {}, { allowUnsigned: true }));
  assert.deepEqual(unsignedConfig.bundle.macOS, {
    hardenedRuntime: false,
    entitlements: null,
  });
  assert.equal("signingIdentity" in unsignedConfig.bundle.macOS, false);
});

test("--allow-unsigned is an explicit release-build opt-in", () => {
  assert.deepEqual(parseArguments(["--target", "macos-aarch64", "--allow-unsigned"]), {
    target: "macos-aarch64",
    validateOnly: false,
    allowUnsigned: true,
  });
  assert.equal(parseArguments([]).allowUnsigned, false);
  assert.deepEqual(macosTauriBuildEnvironment({ EXISTING: "value" }, { allowUnsigned: true }), {
    EXISTING: "value",
    CI: "true",
  });
});

test("missing credentials fail before frontend or sidecar work starts", () => {
  const environment = { ...process.env };
  for (const key of [
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_KEY",
    "APPLE_API_ISSUER",
    "APPLE_API_KEY_PATH",
  ]) {
    delete environment[key];
  }
  const result = spawnSync(
    process.execPath,
    ["scripts/release-build.mjs", "--target", "macos-aarch64"],
    { cwd: studioRoot, encoding: "utf8", env: environment },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /macOS release signing\/notarization credentials are missing/);
  assert.doesNotMatch(result.stdout, /frontend build|sidecar build/);
});

test("unsigned bundle verification keeps architecture and integrity checks but skips Gatekeeper assessment", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ticketry-release-build-"));
  const app = path.join(temporaryRoot, "Ticketry.app");
  const appExecutable = path.join(app, "Contents", "MacOS", manifest.artifacts.tauri.binary_name);
  const embeddedSidecar = path.join(app, "Contents", "Resources", manifest.targets[0].sidecar.bundle_binary_name);
  const embeddedHook = path.join(app, "Contents", "Resources", "ticketry-hook");
  await Promise.all([
    mkdir(path.dirname(appExecutable), { recursive: true }),
    mkdir(path.dirname(embeddedSidecar), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(appExecutable, ""),
    writeFile(embeddedSidecar, ""),
    writeFile(embeddedHook, ""),
  ]);

  const calls = [];
  const logs = [];
  try {
    await verifyMacOSBundle(manifest, manifest.targets[0], { app }, {
      allowUnsigned: true,
      capture: async (command, args, label) => {
        calls.push([command, ...args, label]);
        return "arm64";
      },
      execute: async (command, args, label) => calls.push([command, ...args, label]),
      log: (message) => logs.push(message),
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  assert.equal(calls.filter(([command]) => command === "lipo").length, 3);
  assert.equal(calls.some((call) => call.includes("embedded sidecar architecture check for macos-aarch64")), true);
  assert.equal(calls.some((call) => call.includes("embedded hook runner architecture check for macos-aarch64")), true);
  assert.equal(calls.some(([command, ...args]) => command === "codesign" && args.includes("-s") && args.includes("-")), true);
  assert.equal(
    calls.some(([command, ...args]) => command === "codesign"
      && args.includes("--verify")
      && args.includes("--deep")
      && args.includes("--strict")
      && args.includes("--verbose=2")),
    true,
  );
  assert.equal(calls.some(([command]) => command === "spctl"), false);
  assert.match(logs.join("\n"), /Skipping spctl assessment.*--allow-unsigned/);
});

test("release metadata records signing and notarization status explicitly", () => {
  const signed = releaseMetadata(manifest, manifest.targets[0]);
  const unsigned = releaseMetadata(manifest, manifest.targets[0], { allowUnsigned: true });
  assert.deepEqual([signed.signed, signed.notarized], [true, true]);
  assert.deepEqual([unsigned.signed, unsigned.notarized], [false, false]);
});

test("unsigned staging copies the app and dmg and writes explicit metadata", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ticketry-release-stage-"));
  const sourceApp = path.join(temporaryRoot, "source", "Ticketry.app");
  const sourceDmg = path.join(temporaryRoot, "source", "Ticketry_0.1.0_aarch64.dmg");
  await mkdir(sourceApp, { recursive: true });
  await writeFile(path.join(sourceApp, "marker"), "app");
  await writeFile(sourceDmg, "dmg");
  try {
    const destination = await stageTarget(
      manifest,
      manifest.targets[0],
      { app: sourceApp, dmg: sourceDmg },
      { allowUnsigned: true, root: temporaryRoot },
    );
    assert.equal(await readFile(path.join(destination, "Ticketry.app", "marker"), "utf8"), "app");
    assert.equal(await readFile(path.join(destination, path.basename(sourceDmg)), "utf8"), "dmg");
    const metadata = JSON.parse(await readFile(path.join(destination, "release-metadata.json"), "utf8"));
    assert.deepEqual([metadata.signed, metadata.notarized], [false, false]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the app and Cargo package versions must remain aligned with the release manifest", () => {
  assert.doesNotThrow(() => validateComponentVersions(manifest, {
    tauriVersion: manifest.release_version,
    cargoVersion: manifest.release_version,
  }));
  assert.throws(() => validateComponentVersions(manifest, {
    tauriVersion: "0.1.1",
    cargoVersion: manifest.release_version,
  }), /tauriVersion version "0.1.1" must match release_version/);
});

test("missing declared runtime resources and migrations fail validation", async () => {
  const missingSidecar = structuredClone(manifest);
  missingSidecar.artifacts.sidecar.build_script = "../backend/packaging/not-present.sh";
  await assert.rejects(
    validateReleaseInputs(missingSidecar),
    /sidecar build script is missing/,
  );

  const missingAsset = structuredClone(manifest);
  missingAsset.artifacts.runtime_resources = ["src-tauri/icons/not-present.icns"];
  await assert.rejects(
    validateReleaseInputs(missingAsset),
    /runtime resource is missing/,
  );

  const missingMigration = structuredClone(manifest);
  missingMigration.artifacts.sidecar.migration_directories = ["../backend/missing-migrations"];
  await assert.rejects(
    validateReleaseInputs(missingMigration),
    /declared migration directory is missing/,
  );

  const missingDependencyPolicyFile = structuredClone(manifest);
  missingDependencyPolicyFile.artifacts.sidecar.dependency_policy.python_lock = "../backend/not-present.lock";
  await assert.rejects(
    validateReleaseInputs(missingDependencyPolicyFile),
    /Python dependency lock is missing/,
  );

  const missingEntitlements = structuredClone(manifest);
  missingEntitlements.release_policy.macos.signing.entitlements = "src-tauri/not-present.plist";
  await assert.rejects(
    validateReleaseInputs(missingEntitlements, undefined, { includeFrontendOutputs: false }),
    /macOS signing entitlements is missing/,
  );
});
