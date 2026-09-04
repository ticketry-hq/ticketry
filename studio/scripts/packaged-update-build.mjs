import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export class PackagedUpdateBuildError extends Error {}

function fail(message) {
  throw new PackagedUpdateBuildError(message);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} is required`);
  }
  return value;
}

function unsignedEnvironment(environment, privateKey, privateKeyPassword) {
  const {
    APPLE_SIGNING_IDENTITY: _signingIdentity,
    APPLE_ID: _appleId,
    APPLE_PASSWORD: _applePassword,
    APPLE_TEAM_ID: _appleTeamId,
    APPLE_API_KEY: _appleApiKey,
    APPLE_API_ISSUER: _appleApiIssuer,
    APPLE_API_KEY_PATH: _appleApiKeyPath,
    ...safeEnvironment
  } = environment;
  return {
    ...safeEnvironment,
    CI: "true",
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: privateKeyPassword,
  };
}

export function createPackagedUpdateBuildCommand({
  version,
  updaterPublicKey,
  updaterPrivateKey,
  updaterPrivateKeyPassword,
  feedUrl,
  environment = {},
}) {
  const privateKey = requireText(
    updaterPrivateKey,
    "updater signing private key",
  );
  const privateKeyPassword = requireText(
    updaterPrivateKeyPassword,
    "updater signing private key password",
  );
  const config = {
    version: requireText(version, "application version"),
    bundle: {
      targets: ["app"],
      createUpdaterArtifacts: true,
      macOS: {
        signingIdentity: null,
        hardenedRuntime: false,
        entitlements: null,
      },
    },
    plugins: {
      updater: {
        pubkey: requireText(updaterPublicKey, "updater public key"),
        endpoints: [requireText(feedUrl, "updater feed URL")],
      },
    },
  };

  return {
    command: "npm",
    args: [
      "run",
      "tauri",
      "--",
      "build",
      "--target",
      "aarch64-apple-darwin",
      "--features",
      "native-libghostty,desktop-acceptance",
      "--config",
      JSON.stringify(config),
      "--",
      "--bin",
      "ticketry",
    ],
    environment: unsignedEnvironment(
      environment,
      privateKey,
      privateKeyPassword,
    ),
  };
}

export async function loadGeneratedUpdaterPublicKey(
  publicKeyPath,
  { readFile: read = readFile } = {},
) {
  const publicKey = await read(
    requireText(publicKeyPath, "updater public key path"),
    "utf8",
  );
  return requireText(publicKey.trim(), "generated updater public key");
}

async function listArtifacts(bundleRoot) {
  const entries = await readdir(bundleRoot);
  return entries.map((entry) => path.join(bundleRoot, entry));
}

async function copyArtifact(source, destination, options) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, options);
}

function requireSingleArtifact(artifacts, predicate, label) {
  const matches = artifacts.filter(predicate);
  if (matches.length !== 1) fail(`${label} is missing or ambiguous`);
  return matches[0];
}

export async function stagePackagedUpdateArtifacts({
  versionA,
  versionB,
  stagingRoot,
  boundaries = {},
}) {
  const versionAName = requireText(versionA?.version, "version A");
  const versionBName = requireText(versionB?.version, "version B");
  const versionARoot = requireText(versionA?.bundleRoot, "version A bundle root");
  const versionBRoot = requireText(versionB?.bundleRoot, "version B bundle root");
  const root = requireText(stagingRoot, "artifact staging root");
  if (path.resolve(versionARoot) === path.resolve(versionBRoot)) {
    fail("distinct version A and version B bundle roots are required");
  }

  const list = boundaries.listArtifacts ?? listArtifacts;
  const copy = boundaries.copy ?? copyArtifact;
  const versionAArtifacts = await list(versionARoot);
  const versionBArtifacts = await list(versionBRoot);
  if (!Array.isArray(versionAArtifacts) || !Array.isArray(versionBArtifacts)) {
    fail("artifact listings must be arrays");
  }

  const versionAApp = requireSingleArtifact(
    versionAArtifacts,
    (artifact) => artifact.endsWith(".app"),
    "version A app artifact",
  );
  const versionBArchive = requireSingleArtifact(
    versionBArtifacts,
    (artifact) => artifact.endsWith(".app.tar.gz")
      && versionBArtifacts.includes(`${artifact}.sig`),
    "version B updater archive and signature pair",
  );
  const versionBSignature = `${versionBArchive}.sig`;
  const destinations = {
    versionAApp: path.join(root, "A", path.basename(versionAApp)),
    versionBArchive: path.join(root, "B", path.basename(versionBArchive)),
    versionBSignature: path.join(root, "B", path.basename(versionBSignature)),
  };

  await copy(versionAApp, destinations.versionAApp, { recursive: true });
  await copy(versionBArchive, destinations.versionBArchive);
  await copy(versionBSignature, destinations.versionBSignature);

  return {
    versionA: versionAName,
    versionB: versionBName,
    ...destinations,
  };
}

async function runCommand(command, args, label) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${code ?? signal})`));
    });
  });
}

export async function signArchiveWithWrongKey({
  archivePath,
  privateKeyPath,
  privateKeyPassword,
  runCommand: execute = runCommand,
}) {
  const archive = requireText(archivePath, "wrong-key updater archive");
  await execute(
    "npm",
    [
      "run",
      "tauri",
      "--",
      "signer",
      "sign",
      "--private-key-path",
      requireText(privateKeyPath, "wrong updater signing private key"),
      "--password",
      requireText(privateKeyPassword, "wrong updater signing private key password"),
      archive,
    ],
    "sign wrong-key updater archive",
  );
  return `${archive}.sig`;
}
