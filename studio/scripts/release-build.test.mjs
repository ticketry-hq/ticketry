import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ReleaseDefaultsArtifactError,
  ReleaseManifestError,
  buildRelease,
  macosTauriBuildEnvironment,
  macosTauriSigningConfig,
  parseArguments,
  rebuildUnsignedDmg,
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
const studioPackage = JSON.parse(await readFile(path.join(studioRoot, "package.json"), "utf8"));
const reviewedDefaults = JSON.parse(
  await readFile(path.resolve(studioRoot, manifest.artifacts.sidecar.defaults_artifact), "utf8"),
);

test("the Tauri bundle declares the packaged macOS application icon", async () => {
  const configuration = JSON.parse(
    await readFile(path.join(studioRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  assert.ok(configuration.bundle.icon.includes("icons/icon.icns"));
});

test("release builds compile the native libghostty terminal renderer", () => {
  assert.deepEqual(
    manifest.artifacts.tauri.command.slice(-2),
    ["--features", "native-libghostty"],
  );

  const withoutNativeTerminal = structuredClone(manifest);
  withoutNativeTerminal.artifacts.tauri.command =
    withoutNativeTerminal.artifacts.tauri.command.slice(0, -2);
  assert.throws(
    () => validateManifest(withoutNativeTerminal),
    /must enable the native-libghostty feature/,
  );
});

test("release builds resolve the workspace-owned Tauri CLI", () => {
  assert.deepEqual(
    manifest.artifacts.tauri.command.slice(0, 4),
    ["npm", "run", "tauri", "--"],
  );
  assert.equal(studioPackage.scripts.tauri, "tauri");
});

test("release bundles the pinned libghostty runtime resources", async () => {
  const [configuration, prepareScript, nativePatch] = await Promise.all([
    readFile(path.join(studioRoot, "src-tauri", "tauri.conf.json"), "utf8").then(JSON.parse),
    readFile(path.join(studioRoot, "scripts", "prepare-libghostty.sh"), "utf8"),
    readFile(path.join(studioRoot, "scripts", "libghostty-macos-static.patch"), "utf8"),
  ]);

  assert.equal(
    configuration.bundle.resources["vendor/libghostty/resources/"],
    "",
  );
  assert.match(prepareScript, /zig-out\/share\/ghostty/);
  assert.match(prepareScript, /zig-out\/share\/terminfo/);
  assert.match(nativePatch, /\+\s+resources\.install\(\);/);
});

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

  const missingDefaultsArtifact = structuredClone(manifest);
  delete missingDefaultsArtifact.artifacts.sidecar.defaults_artifact;
  assert.throws(
    () => validateManifest(missingDefaultsArtifact),
    /artifacts\.sidecar\.defaults_artifact/,
  );

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
  const ghosttyTerminfo = path.join(app, "Contents", "Resources", "terminfo", "78", "xterm-ghostty");
  const ghosttyShellIntegration = path.join(
    app,
    "Contents",
    "Resources",
    "ghostty",
    "shell-integration",
    "zsh",
    "ghostty-integration",
  );
  await Promise.all([
    mkdir(path.dirname(appExecutable), { recursive: true }),
    mkdir(path.dirname(embeddedSidecar), { recursive: true }),
    mkdir(path.dirname(ghosttyTerminfo), { recursive: true }),
    mkdir(path.dirname(ghosttyShellIntegration), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(appExecutable, ""),
    writeFile(embeddedSidecar, ""),
    writeFile(embeddedHook, ""),
    writeFile(ghosttyTerminfo, ""),
    writeFile(ghosttyShellIntegration, ""),
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

test("unsigned DMG is rebuilt from the exact verified app", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ticketry-release-dmg-"));
  const app = path.join(temporaryRoot, "bundle", "macos", "Ticketry.app");
  const dmg = path.join(temporaryRoot, "bundle", "dmg", "Ticketry_0.1.0_aarch64.dmg");
  const bundleScript = path.join(path.dirname(dmg), "bundle_dmg.sh");
  await Promise.all([
    mkdir(app, { recursive: true }),
    mkdir(path.dirname(dmg), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(app, "verified-marker"), "verified"),
    writeFile(dmg, "stale pre-verification image"),
    writeFile(bundleScript, "#!/usr/bin/env bash\n"),
  ]);

  const calls = [];
  try {
    await rebuildUnsignedDmg({ app, dmg }, {
      execute: async (command, args, label) => {
        calls.push([command, ...args, label]);
        await assert.rejects(readFile(dmg), /ENOENT/);
        assert.equal(
          await readFile(path.join(args.at(-1), "Ticketry.app", "verified-marker"), "utf8"),
          "verified",
        );
        await writeFile(dmg, "rebuilt from verified app");
      },
    });
    assert.equal(await readFile(dmg, "utf8"), "rebuilt from verified app");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 12), [
    "bash",
    bundleScript,
    "--volname",
    "Ticketry",
    "--icon",
    "Ticketry.app",
    "180",
    "170",
    "--app-drop-link",
    "320",
    "170",
    "--skip-jenkins",
  ]);
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

test("the release manifest declares the reviewed defaults artifact as a sidecar input", () => {
  assert.equal(
    manifest.artifacts.sidecar.defaults_artifact,
    "../backend/worktracker/reviewed_defaults.json",
  );
});

test("missing, unparseable, and invalid defaults artifacts fail release-input validation", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ticketry-release-defaults-"));
  const invalidDefaults = structuredClone(reviewedDefaults);
  invalidDefaults.workflows.Story.transitions = [["Ideas", "Unknown state"]];
  const cases = [
    {
      name: "missing",
      path: path.join(temporaryRoot, "missing.json"),
      message: /defaults artifact is missing or unreadable/,
    },
    {
      name: "unparseable",
      path: path.join(temporaryRoot, "unparseable.json"),
      contents: "{ definitely not json",
      message: /defaults artifact is not parseable JSON/,
    },
    {
      name: "invalid but parseable",
      path: path.join(temporaryRoot, "invalid.json"),
      contents: JSON.stringify(invalidDefaults),
      message: /Issue type 'Story' edge 'Ideas -> Unknown state'/,
    },
  ];

  try {
    for (const fixture of cases) {
      if (fixture.contents !== undefined) {
        await writeFile(fixture.path, fixture.contents);
      }
      const invalidManifest = structuredClone(manifest);
      invalidManifest.artifacts.sidecar.defaults_artifact = fixture.path;

      await assert.rejects(
        validateReleaseInputs(invalidManifest, undefined, {
          includeFrontendOutputs: false,
          allowUnsigned: true,
        }),
        (error) => {
          assert.ok(error instanceof ReleaseDefaultsArtifactError, fixture.name);
          assert.match(error.message, fixture.message);
          return true;
        },
      );

      const commands = [];
      await assert.rejects(
        buildRelease(invalidManifest, invalidManifest.targets, {
          allowUnsigned: true,
          execute: async (...command) => commands.push(command),
        }),
        ReleaseDefaultsArtifactError,
      );
      assert.deepEqual(commands, [], `${fixture.name} artifact ran a build command`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
