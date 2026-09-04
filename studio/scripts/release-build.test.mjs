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
  hookRunnerBuild,
  parseArguments,
  releaseMetadata,
  selectTargets,
  stageTarget,
  tauriBuildArguments,
  validateComponentVersions,
  validateLatestJson,
  validateMacOSReleaseEnvironment,
  validateManifest,
  validateReleaseInputs,
  verifyMacOSBundle,
} from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(
  await readFile(path.join(studioRoot, "release", "manifest.v1.json"), "utf8"),
);

function latestJson(overrides = {}) {
  return {
    version: manifest.release_version,
    notes: "Security and reliability fixes.",
    pub_date: "2026-08-31T12:00:00Z",
    platforms: {
      "darwin-aarch64": {
        signature: "signed updater payload",
        url: "https://github.com/ticketry-hq/ticketry-updates/releases/download/v0.2.0/Ticketry.app.tar.gz",
      },
    },
    ...overrides,
  };
}

test("the release ships native libghostty with the browser Ghostty WASM artifact", () => {
  assert.equal(manifest.release_version, "0.2.0");
  assert.deepEqual(Object.keys(manifest.artifacts).sort(), [
    "frontend", "runtime_resources", "tauri", "updater",
  ]);
  assert.deepEqual(manifest.artifacts.tauri.command.slice(-2), [
    "--features", "native-libghostty",
  ]);
  assert.ok(manifest.artifacts.frontend.required_outputs.includes(
    "dist/ghostty-vt/ghostty-vt.wasm",
  ));
  assert.equal(JSON.stringify(manifest).includes("python"), false);
  assert.equal(JSON.stringify(manifest).includes("sidecar"), false);
  assert.doesNotThrow(() => validateManifest(manifest));
});

test("the shipping Cargo package builds one binary and no developer tools", async () => {
  const cargoToml = await readFile(path.join(studioRoot, "src-tauri", "Cargo.toml"), "utf8");
  assert.match(cargoToml, /autobins = false/);
  // The developer command line is its own package now, so the release package
  // cannot build it by accident: `ticketry` is the only [[bin]] it declares.
  assert.deepEqual(cargoToml.match(/^\[\[bin\]\]\nname = "[^"]+"$/gm), [
    '[[bin]]\nname = "ticketry"',
  ]);
  assert.equal(cargoToml.includes("verify_slice6_copy"), false);

  const devToolsToml = await readFile(
    path.join(studioRoot, "src-tauri", "crates", "ticketry-dev-tools", "Cargo.toml"),
    "utf8",
  );
  assert.match(devToolsToml, /name = "verify_slice6_copy"/);
  assert.match(devToolsToml, /publish = false/);
});

test("the release builds the target-specific hook runner expected by Tauri", () => {
  const build = hookRunnerBuild(manifest.targets[0], "/repository/studio");
  assert.equal(build.command, "rustc");
  assert.deepEqual(build.args, [
    "/repository/studio/src-tauri/native/ticketry_hook.rs",
    "--edition",
    "2021",
    "--target",
    "aarch64-apple-darwin",
    "-O",
    "-o",
    "/repository/studio/src-tauri/binaries/ticketry-hook-aarch64-apple-darwin",
  ]);
});

test("manifest validation requires Rust runtime and release policy declarations", () => {
  const withoutNativeRenderer = structuredClone(manifest);
  withoutNativeRenderer.artifacts.tauri.command =
    withoutNativeRenderer.artifacts.tauri.command.slice(0, -2);
  assert.throws(() => validateManifest(withoutNativeRenderer), /native-libghostty/);
  const withoutWasm = structuredClone(manifest);
  withoutWasm.artifacts.frontend.required_outputs = ["dist/index.html"];
  assert.throws(() => validateManifest(withoutWasm), /ghostty-vt\/ghostty-vt\.wasm/);
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

test("manifest validation requires updater artifact declarations", () => {
  const withoutUpdater = structuredClone(manifest);
  delete withoutUpdater.artifacts.updater;
  assert.throws(() => validateManifest(withoutUpdater), /artifacts\.updater/);
});

test("manifest validation requires the Tauri macOS updater archive suffix", () => {
  const wrongArchive = structuredClone(manifest);
  wrongArchive.artifacts.updater.archive_suffix = ".zip";
  assert.throws(() => validateManifest(wrongArchive), /archive_suffix must be \.app\.tar\.gz/);
});

test("manifest validation requires the updater signature to match the archive suffix", () => {
  const wrongSignature = structuredClone(manifest);
  wrongSignature.artifacts.updater.signature_suffix = ".sig";
  assert.throws(
    () => validateManifest(wrongSignature),
    /signature_suffix must be \.app\.tar\.gz\.sig/,
  );
});

test("manifest validation requires latest.json in Tauri static JSON format", () => {
  const wrongLatestManifest = structuredClone(manifest);
  wrongLatestManifest.artifacts.updater.latest_manifest.filename = "update.json";
  assert.throws(() => validateManifest(wrongLatestManifest), /latest_manifest\.filename must be latest\.json/);
});

test("manifest validation rejects unsigned updater artifact policy", () => {
  const unsignedUpdater = structuredClone(manifest);
  unsignedUpdater.artifacts.updater.archive_policy.signed = false;
  assert.throws(() => validateManifest(unsignedUpdater), /must require signed and notarized updater archives/);
});

test("manifest validation requires the configured public stable update feed", () => {
  const withoutFeedUrl = structuredClone(manifest);
  delete withoutFeedUrl.release_policy.update.feed.latest_url;
  assert.throws(() => validateManifest(withoutFeedUrl), /release policy update feed latest URL/);
});

test("manifest validation binds the Tauri updater signing environment", () => {
  const wrongSigningEnvironment = structuredClone(manifest);
  wrongSigningEnvironment.artifacts.updater.signing.private_key_environment = "PRIVATE_KEY";
  assert.throws(
    () => validateManifest(wrongSigningEnvironment),
    /private_key_environment must be TAURI_SIGNING_PRIVATE_KEY/,
  );
});

test("latest.json requires non-empty release notes", () => {
  assert.throws(() => validateLatestJson(manifest, latestJson({ notes: "  " })), /non-empty notes/);
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
  assert.throws(
    () => validateMacOSReleaseEnvironment(signed),
    /TAURI_SIGNING_PRIVATE_KEY.*TAURI_SIGNING_PRIVATE_KEY_PASSWORD/,
  );
  const signedUpdater = {
    ...signed,
    TAURI_SIGNING_PRIVATE_KEY: "updater private key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "updater key password",
  };
  assert.doesNotThrow(() => validateMacOSReleaseEnvironment(signedUpdater));
  assert.throws(
    () => validateMacOSReleaseEnvironment(signedUpdater, { allowUnsigned: true }),
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

test("unsigned bundle verification checks binaries and native Ghostty resources", async () => {
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
