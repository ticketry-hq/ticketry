import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ReleaseManifestError,
  macosTauriSigningConfig,
  selectTargets,
  validateComponentVersions,
  validateMacOSReleaseEnvironment,
  validateManifest,
  validateReleaseInputs,
} from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(studioRoot, "release", "manifest.v1.json"), "utf8"));

test("the release manifest declares only the supported macOS architectures", () => {
  assert.deepEqual(selectTargets(manifest).map(({ id }) => id), ["macos-aarch64", "macos-x86_64"]);
  assert.equal(manifest.targets.every(({ platform }) => platform === "macos"), true);
});

test("an undeclared target fails before a build can start", () => {
  assert.throws(
    () => selectTargets(manifest, "windows-x86_64"),
    /not declared.*macos-aarch64, macos-x86_64/,
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
