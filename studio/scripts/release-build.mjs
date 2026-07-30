import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { validateFinalizedDefaults } from "../../backend/worktracker/reviewed_defaults_validator.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = path.join(studioRoot, "release", "manifest.v1.json");

export class ReleaseManifestError extends Error {}

export class ReleaseDefaultsArtifactError extends ReleaseManifestError {
  constructor(message, options) {
    super(message, options);
    this.name = "ReleaseDefaultsArtifactError";
  }
}

function requireValue(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new ReleaseManifestError(`release manifest is missing ${label}`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReleaseManifestError(`release manifest must declare ${label}`);
  }
  return value;
}

export function validateManifest(manifest) {
  if (manifest?.schema_version !== 1) {
    throw new ReleaseManifestError("release manifest schema_version must be 1");
  }
  requireValue(manifest.release_version, "release_version");
  requireValue(manifest.product, "product");
  const artifacts = requireValue(manifest.artifacts, "artifacts");
  requireArray(artifacts.frontend?.command, "artifacts.frontend.command");
  requireArray(artifacts.frontend?.required_outputs, "artifacts.frontend.required_outputs");
  const tauriCommand = requireArray(artifacts.tauri?.command, "artifacts.tauri.command");
  if (!tauriCommand.includes("native-libghostty")) {
    throw new ReleaseManifestError(
      "artifacts.tauri.command must enable the native-libghostty feature",
    );
  }
  requireValue(artifacts.tauri?.binary_name, "artifacts.tauri.binary_name");
  requireArray(artifacts.tauri?.bundle_formats, "artifacts.tauri.bundle_formats");
  requireValue(artifacts.sidecar?.build_script, "artifacts.sidecar.build_script");
  requireValue(artifacts.sidecar?.defaults_artifact, "artifacts.sidecar.defaults_artifact");
  requireArray(artifacts.sidecar?.migration_directories, "artifacts.sidecar.migration_directories");
  requireValue(artifacts.sidecar?.dependency_policy?.python_lock, "sidecar dependency policy python_lock");
  requireValue(artifacts.sidecar?.dependency_policy?.python_project, "sidecar dependency policy python_project");
  requireValue(artifacts.sidecar?.dependency_policy?.node_lock, "sidecar dependency policy node_lock");
  requireArray(artifacts.runtime_resources, "artifacts.runtime_resources");
  const policy = requireValue(manifest.release_policy, "release_policy");
  requireValue(policy.macos?.signing?.identity_environment, "release policy macOS signing identity environment");
  requireValue(policy.macos?.signing?.entitlements, "release policy macOS entitlements");
  if (policy.macos?.signing?.hardened_runtime !== true) {
    throw new ReleaseManifestError("release policy must require the macOS hardened runtime");
  }
  if (policy.macos?.notarization?.required !== true) {
    throw new ReleaseManifestError("release policy must require macOS notarization");
  }
  requireArray(policy.macos?.notarization?.authentication, "release policy macOS notarization authentication");
  requireValue(policy.update?.delivery, "release policy update delivery");
  requireArray(policy.update?.compatibility, "release policy update compatibility");
  if (policy.update?.automatic_updates !== false) {
    throw new ReleaseManifestError("release policy must explicitly disable unverified automatic updates");
  }
  requireValue(policy.rollback?.strategy, "release policy rollback strategy");
  requireValue(policy.rollback?.recovery_document, "release policy recovery document");
  requireValue(policy.retention?.previous_installer_versions, "release policy retention");
  requireValue(policy.data?.location, "release policy data location");
  requireValue(policy.data?.uninstall, "release policy uninstall behavior");
  requireArray(policy.data?.preserve, "release policy data preservation");

  const targets = requireArray(manifest.targets, "targets");
  const ids = new Set();
  for (const target of targets) {
    const id = requireValue(target.id, "target id");
    if (ids.has(id)) throw new ReleaseManifestError(`release manifest repeats target ${id}`);
    ids.add(id);
    requireValue(target.platform, `target ${id}.platform`);
    requireValue(target.architecture, `target ${id}.architecture`);
    requireValue(target.build_architecture, `target ${id}.build_architecture`);
    requireValue(target.rust_target, `target ${id}.rust_target`);
    requireValue(target.sidecar?.target_triple, `target ${id}.sidecar.target_triple`);
    requireValue(target.sidecar?.bundle_binary_name, `target ${id}.sidecar.bundle_binary_name`);
    requireValue(target.compatibility?.minimum_os, `target ${id}.compatibility.minimum_os`);
    requireValue(target.compatibility?.tmux, `target ${id}.compatibility.tmux`);
    requireValue(target.compatibility?.runtime_protocol, `target ${id}.compatibility.runtime_protocol`);
    requireValue(target.compatibility?.database_schema, `target ${id}.compatibility.database_schema`);
    if (target.compatibility?.app_version !== manifest.release_version) {
      throw new ReleaseManifestError(`target ${id}.compatibility.app_version must match release_version`);
    }
    if (target.compatibility?.sidecar_version !== manifest.release_version) {
      throw new ReleaseManifestError(`target ${id}.compatibility.sidecar_version must match release_version`);
    }
  }
  return manifest;
}

function macOSCredentialState(environment) {
  const passwordAuthentication = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
  const apiKeyAuthentication = ["APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PATH"];
  const hasPasswordAuthentication = passwordAuthentication.every((key) => environment[key]);
  const hasApiKeyAuthentication = apiKeyAuthentication.every((key) => environment[key]);
  return {
    hasSigningIdentity: Boolean(environment.APPLE_SIGNING_IDENTITY),
    hasNotarizationAuthentication: hasPasswordAuthentication || hasApiKeyAuthentication,
  };
}

export function validateMacOSReleaseEnvironment(environment = process.env, { allowUnsigned = false } = {}) {
  const { hasSigningIdentity, hasNotarizationAuthentication } = macOSCredentialState(environment);
  if (allowUnsigned) {
    if (hasSigningIdentity && hasNotarizationAuthentication) {
      throw new ReleaseManifestError(
        "--allow-unsigned cannot be used when complete macOS signing and notarization credentials are present",
      );
    }
    return;
  }
  const missing = [];
  if (!hasSigningIdentity) missing.push("APPLE_SIGNING_IDENTITY");
  if (!hasNotarizationAuthentication) {
    missing.push("APPLE_ID,APPLE_PASSWORD,APPLE_TEAM_ID or APPLE_API_KEY,APPLE_API_ISSUER,APPLE_API_KEY_PATH");
  }
  if (missing.length > 0) {
    throw new ReleaseManifestError(`macOS release signing/notarization credentials are missing: ${missing.join("; ")}`);
  }
}

export function validateComponentVersions(manifest, { tauriVersion, cargoVersion }) {
  for (const [component, version] of Object.entries({ tauriVersion, cargoVersion })) {
    if (version !== manifest.release_version) {
      throw new ReleaseManifestError(
        `${component} version ${JSON.stringify(version)} must match release_version ${manifest.release_version}`,
      );
    }
  }
}

export function macosTauriSigningConfig(manifest, environment = process.env, { allowUnsigned = false } = {}) {
  const signing = manifest.release_policy.macos.signing;
  if (allowUnsigned) {
    return JSON.stringify({
      bundle: {
        macOS: {
          hardenedRuntime: false,
          entitlements: null,
        },
      },
    });
  }
  return JSON.stringify({
    bundle: {
      macOS: {
        signingIdentity: environment[signing.identity_environment],
        hardenedRuntime: signing.hardened_runtime,
        entitlements: path.basename(signing.entitlements),
      },
    },
  });
}

export function macosTauriBuildEnvironment(environment = process.env, { allowUnsigned = false } = {}) {
  if (!allowUnsigned) return environment;
  return { ...environment, CI: "true" };
}

export function selectTargets(manifest, requestedTarget = "all") {
  validateManifest(manifest);
  if (requestedTarget === "all") return manifest.targets;
  const target = manifest.targets.find(({ id }) => id === requestedTarget);
  if (!target) {
    throw new ReleaseManifestError(
      `Unsupported release target "${requestedTarget}" for ${path.basename(manifestPath)}. `
        + `Declared targets: ${manifest.targets.map(({ id }) => id).join(", ")}.`,
    );
  }
  return [target];
}

async function requireFile(root, relativePath, label) {
  const absolutePath = path.resolve(root, relativePath);
  try {
    if (!(await stat(absolutePath)).isFile()) throw new Error("not a file");
  } catch {
    throw new ReleaseManifestError(`${label} is missing: ${relativePath}`);
  }
  return absolutePath;
}

async function requireMigrationDirectory(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  let entries;
  try {
    entries = await readdir(absolutePath);
  } catch {
    throw new ReleaseManifestError(`declared migration directory is missing: ${relativePath}`);
  }
  if (!entries.some((entry) => /^\d+_.+\.py$/.test(entry))) {
    throw new ReleaseManifestError(`declared migration directory has no migrations: ${relativePath}`);
  }
}

async function validateDefaultsArtifact(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  let source;
  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new ReleaseDefaultsArtifactError(
      `release defaults artifact is missing or unreadable: ${relativePath}`,
      { cause: error },
    );
  }

  let artifact;
  try {
    artifact = JSON.parse(source);
  } catch (error) {
    throw new ReleaseDefaultsArtifactError(
      `release defaults artifact is not parseable JSON (${relativePath}): ${error.message}`,
      { cause: error },
    );
  }

  const errors = validateFinalizedDefaults(artifact);
  if (errors.length > 0) {
    throw new ReleaseDefaultsArtifactError(
      `release defaults artifact is invalid (${relativePath}):\n- ${errors.join("\n- ")}`,
    );
  }
}

async function validateFrontendOutputs(manifest, root = studioRoot) {
  await Promise.all(
    manifest.artifacts.frontend.required_outputs.map((asset) =>
      requireFile(root, asset, "frontend asset"),
    ),
  );
}

export async function validateReleaseInputs(
  manifest,
  root = studioRoot,
  { includeFrontendOutputs = true, allowUnsigned = false } = {},
) {
  validateManifest(manifest);
  const { artifacts } = manifest;
  await validateDefaultsArtifact(root, artifacts.sidecar.defaults_artifact);
  await requireFile(root, artifacts.sidecar.build_script, "sidecar build script");
  await Promise.all([
    requireFile(root, artifacts.sidecar.dependency_policy.python_lock, "Python dependency lock"),
    requireFile(root, artifacts.sidecar.dependency_policy.python_project, "Python dependency policy"),
    requireFile(root, artifacts.sidecar.dependency_policy.node_lock, "Node dependency lock"),
    ...(includeFrontendOutputs
      ? artifacts.frontend.required_outputs.map((asset) => requireFile(root, asset, "frontend asset"))
      : []),
    ...artifacts.runtime_resources.map((asset) => requireFile(root, asset, "runtime resource")),
    ...(allowUnsigned
      ? []
      : [requireFile(root, manifest.release_policy.macos.signing.entitlements, "macOS signing entitlements")]),
    requireFile(root, manifest.release_policy.rollback.recovery_document, "rollback recovery document"),
    ...artifacts.sidecar.migration_directories.map((directory) => requireMigrationDirectory(root, directory)),
  ]);
  let tauriConfiguration;
  let cargoToml;
  try {
    [tauriConfiguration, cargoToml] = await Promise.all([
      readFile(path.resolve(root, "src-tauri", "tauri.conf.json"), "utf8").then(JSON.parse),
      readFile(path.resolve(root, "src-tauri", "Cargo.toml"), "utf8"),
    ]);
  } catch (error) {
    throw new ReleaseManifestError(`could not read versioned desktop components: ${error.message}`);
  }
  if (
    !Array.isArray(tauriConfiguration.bundle?.icon)
    || !tauriConfiguration.bundle.icon.includes("icons/icon.icns")
  ) {
    throw new ReleaseManifestError(
      "Tauri bundle must declare icons/icon.icns as its macOS application icon",
    );
  }
  const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];
  validateComponentVersions(manifest, { tauriVersion: tauriConfiguration.version, cargoVersion });
}

async function run(command, args, label, { environment = process.env } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: studioRoot, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${code ?? signal})`));
    });
  });
}

async function runCapture(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: studioRoot, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${label} failed (${code ?? signal})`));
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }));
  return files.flat();
}

async function findDirectoryWithSuffix(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.name.endsWith(suffix)) return entryPath;
    const nested = await findDirectoryWithSuffix(entryPath, suffix);
    if (nested) return nested;
  }
  return undefined;
}

async function bundleArtifacts(manifest, target) {
  const bundleRoot = path.join(studioRoot, "src-tauri", "target", target.rust_target, "release", "bundle");
  let files;
  try {
    files = await collectFiles(bundleRoot);
  } catch {
    throw new ReleaseManifestError(`Tauri did not produce a bundle directory for ${target.id}: ${bundleRoot}`);
  }
  const app = await findDirectoryWithSuffix(bundleRoot, ".app");
  const dmg = files.find((file) => file.endsWith(".dmg"));
  if (!app || !dmg) {
    throw new ReleaseManifestError(`Tauri did not produce both .app and .dmg bundles for ${target.id}`);
  }
  return { app, dmg };
}

async function findFileWithin(directory, basename) {
  const files = await collectFiles(directory);
  return files.find((file) => path.basename(file) === basename);
}

export async function verifyMacOSBundle(
  manifest,
  target,
  artifacts,
  {
    allowUnsigned = false,
    execute = run,
    capture = runCapture,
    log = console.log,
  } = {},
) {
  const appExecutable = path.join(artifacts.app, "Contents", "MacOS", manifest.artifacts.tauri.binary_name);
  const embeddedSidecar = await findFileWithin(artifacts.app, target.sidecar.bundle_binary_name);
  const embeddedHookRunner = await findFileWithin(artifacts.app, "ticketry-hook");
  if (!(await exists(appExecutable))) {
    throw new ReleaseManifestError(`macOS bundle for ${target.id} is missing its app executable: ${appExecutable}`);
  }
  if (!embeddedSidecar) {
    throw new ReleaseManifestError(`macOS bundle for ${target.id} is missing embedded sidecar ${target.sidecar.bundle_binary_name}`);
  }
  if (!embeddedHookRunner) {
    throw new ReleaseManifestError(`macOS bundle for ${target.id} is missing embedded hook runner ticketry-hook`);
  }
  for (const [label, binary] of [
    ["app", appExecutable],
    ["embedded sidecar", embeddedSidecar],
    ["embedded hook runner", embeddedHookRunner],
  ]) {
    const architectures = await capture("lipo", ["-archs", binary], `${label} architecture check for ${target.id}`);
    if (!architectures.split(/\s+/).includes(target.build_architecture)) {
      throw new ReleaseManifestError(
        `${label} in ${target.id} has architectures "${architectures}", expected ${target.build_architecture}`,
      );
    }
  }
  if (allowUnsigned) {
    await execute(
      "codesign",
      ["--force", "--deep", "-s", "-", artifacts.app],
      `ad-hoc signing for ${target.id}`,
    );
  }
  await execute(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", artifacts.app],
    `signature verification for ${target.id}`,
  );
  if (allowUnsigned) {
    log(`Skipping spctl assessment for ${target.id} because --allow-unsigned was specified.`);
  } else {
    await execute(
      "spctl",
      ["--assess", "--type", "execute", "--verbose=4", artifacts.app],
      `notarization verification for ${target.id}`,
    );
  }
}

export async function rebuildUnsignedDmg(
  artifacts,
  { execute = run } = {},
) {
  const bundleScript = path.join(path.dirname(artifacts.dmg), "bundle_dmg.sh");
  if (!(await exists(bundleScript))) {
    throw new ReleaseManifestError(
      `Tauri DMG bundler is missing; cannot rebuild installer from verified app: ${bundleScript}`,
    );
  }

  const source = await mkdtemp(path.join(tmpdir(), "ticketry-verified-dmg-"));
  const appName = path.basename(artifacts.app);
  const volumeName = path.basename(appName, ".app");
  try {
    await cp(artifacts.app, path.join(source, appName), { recursive: true });
    await rm(artifacts.dmg, { force: true });
    await execute(
      "bash",
      [
        bundleScript,
        "--volname",
        volumeName,
        "--icon",
        appName,
        "180",
        "170",
        "--app-drop-link",
        "320",
        "170",
        "--skip-jenkins",
        artifacts.dmg,
        source,
      ],
      "DMG rebuild from verified unsigned app",
    );
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

export function releaseMetadata(manifest, target, { allowUnsigned = false } = {}) {
  return {
    format_version: 1,
    product: manifest.product,
    release_version: manifest.release_version,
    target: target.id,
    signed: !allowUnsigned,
    notarized: !allowUnsigned,
    components: {
      app_version: target.compatibility.app_version,
      sidecar_version: target.compatibility.sidecar_version,
      runtime_protocol: target.compatibility.runtime_protocol,
      database_schema: target.compatibility.database_schema,
    },
    update_policy: manifest.release_policy.update,
    rollback_policy: manifest.release_policy.rollback,
    data_policy: manifest.release_policy.data,
  };
}

export async function stageTarget(
  manifest,
  target,
  artifacts,
  { allowUnsigned = false, root = studioRoot } = {},
) {
  const destination = path.join(root, "release-output", manifest.release_version, target.id);

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const copyArtifact = async (source, destinationPath, options = {}) => {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(source, destinationPath, options);
  };
  await Promise.all([
    copyArtifact(artifacts.app, path.join(destination, "Ticketry.app"), { recursive: true }),
    copyArtifact(artifacts.dmg, path.join(destination, path.basename(artifacts.dmg)), { recursive: false }),
    writeFile(
      path.join(destination, "release-metadata.json"),
      `${JSON.stringify(releaseMetadata(manifest, target, { allowUnsigned }), null, 2)}\n`,
    ),
  ]);
  return destination;
}

async function verifySidecarArchitecture(target) {
  if (process.platform !== "darwin") {
    throw new ReleaseManifestError(
      `Cannot build ${target.id} on ${process.platform}: this manifest currently declares macOS targets only.`,
    );
  }
  const sidecar = path.join(studioRoot, "src-tauri", "binaries", `${target.sidecar.bundle_binary_name}-${target.sidecar.target_triple}`);
  const architectures = await runCapture("lipo", ["-archs", sidecar], `sidecar architecture check for ${target.id}`);
  if (!architectures.split(/\s+/).includes(target.build_architecture)) {
    throw new ReleaseManifestError(
      `sidecar for ${target.id} has architectures "${architectures}", expected ${target.build_architecture}`,
    );
  }
}

export async function buildRelease(
  manifest,
  targets,
  { allowUnsigned = false, execute = run } = {},
) {
  validateMacOSReleaseEnvironment(process.env, { allowUnsigned });
  await validateReleaseInputs(manifest, studioRoot, {
    includeFrontendOutputs: false,
    allowUnsigned,
  });
  const [frontendCommand, ...frontendArgs] = manifest.artifacts.frontend.command;
  await execute(frontendCommand, frontendArgs, "frontend build");
  await validateFrontendOutputs(manifest);
  for (const target of targets) {
    await execute(
      "arch",
      [`-${target.build_architecture}`, "bash", manifest.artifacts.sidecar.build_script, target.sidecar.target_triple],
      `sidecar build for ${target.id}`,
    );
    await verifySidecarArchitecture(target);
    const [tauriCommand, ...tauriArgs] = manifest.artifacts.tauri.command;
    await execute(
      tauriCommand,
      [
        ...tauriArgs,
        "--target",
        target.rust_target,
        "--config",
        macosTauriSigningConfig(manifest, process.env, { allowUnsigned }),
      ],
      `Tauri build for ${target.id}`,
      { environment: macosTauriBuildEnvironment(process.env, { allowUnsigned }) },
    );
    const artifacts = await bundleArtifacts(manifest, target);
    await verifyMacOSBundle(manifest, target, artifacts, { allowUnsigned });
    if (allowUnsigned) {
      // Ad-hoc signing mutates the app after Tauri has already created its
      // DMG. Recreate the installer so it contains the exact verified app.
      await rebuildUnsignedDmg(artifacts);
    }
    await stageTarget(manifest, target, artifacts, { allowUnsigned });
  }
}

export async function loadManifest(filePath = manifestPath) {
  try {
    return validateManifest(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof ReleaseManifestError) throw error;
    throw new ReleaseManifestError(`could not read release manifest ${filePath}: ${error.message}`);
  }
}

export function parseArguments(arguments_) {
  let target = "all";
  let validateOnly = false;
  let allowUnsigned = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--target") {
      target = arguments_[index + 1];
      index += 1;
    } else if (argument === "--validate") {
      validateOnly = true;
    } else if (argument === "--allow-unsigned") {
      allowUnsigned = true;
    } else {
      throw new ReleaseManifestError(`Unknown release build option: ${argument}`);
    }
  }
  if (!target) throw new ReleaseManifestError("--target requires a manifest target id or all");
  return { target, validateOnly, allowUnsigned };
}

async function main() {
  const { target, validateOnly, allowUnsigned } = parseArguments(process.argv.slice(2));
  const manifest = await loadManifest();
  const targets = selectTargets(manifest, target);
  if (validateOnly) {
    await validateReleaseInputs(manifest, studioRoot, { includeFrontendOutputs: false });
    console.log(`Release manifest is valid for: ${targets.map(({ id }) => id).join(", ")}`);
    return;
  }
  await buildRelease(manifest, targets, { allowUnsigned });
  console.log(`Release ${manifest.release_version} built for: ${targets.map(({ id }) => id).join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
