import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createPackagedUpdateBuildCommand,
  loadGeneratedUpdaterPublicKey,
  signArchiveWithWrongKey,
  stagePackagedUpdateArtifacts,
} from "./packaged-update-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));

export class PackagedUpdateEnvironmentError extends Error {}
function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PackagedUpdateEnvironmentError(`${label} is required`);
  }
  return value;
}

export function runAcceptanceCommand(command, args, label, {
  cwd = studioRoot,
  environment = process.env,
  capture = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env: environment, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    const stdout = [];
    const stderr = [];
    if (capture) {
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
    }
    child.once("error", (error) => reject(new PackagedUpdateEnvironmentError(
      `${label} could not start: ${error.message}`,
    )));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(capture ? Buffer.concat(stdout).toString("utf8") : undefined);
        return;
      }
      const detail = capture ? Buffer.concat(stderr).toString("utf8").trim() : "";
      reject(new PackagedUpdateEnvironmentError(
        `${label} failed (${code ?? signal})${detail ? `: ${detail}` : ""}`,
      ));
    });
  });
}

export async function createPackagedUpdateWorkspace({
  temporaryRoot = tmpdir(),
  keep = process.env.TICKETRY_KEEP_PACKAGED_UPDATE_ACCEPTANCE === "1",
  boundaries = {},
} = {}) {
  const makeTemporaryDirectory = boundaries.mkdtemp ?? mkdtemp;
  const makeDirectory = boundaries.mkdir ?? mkdir;
  const remove = boundaries.rm ?? rm;
  const root = await makeTemporaryDirectory(
    path.join(temporaryRoot, "ticketry-packaged-update-"),
  );
  const workspace = {
    root,
    keysDirectory: path.join(root, "keys"),
    tlsDirectory: path.join(root, "tls"),
    artifactsDirectory: path.join(root, "artifacts"),
    installationsDirectory: path.join(root, "installations"),
    evidenceDirectory: path.join(root, "evidence"),
    buildDirectories: {
      versionA: path.join(root, "build-a"),
      versionB: path.join(root, "build-b"),
    },
  };
  await Promise.all([
    workspace.keysDirectory,
    workspace.tlsDirectory,
    workspace.artifactsDirectory,
    workspace.installationsDirectory,
    workspace.evidenceDirectory,
    workspace.buildDirectories.versionA,
    workspace.buildDirectories.versionB,
  ].map((directory) => makeDirectory(directory, { recursive: true })));
  let disposed = false;
  return {
    ...workspace,
    retained: keep,
    async dispose() {
      if (disposed || keep) return;
      disposed = true;
      await remove(root, { recursive: true, force: true });
    },
  };
}

function generatedPassword() {
  return randomBytes(24).toString("base64url");
}

export async function generateUpdaterKeyPair({
  workspace,
  name,
  password = generatedPassword(),
  boundaries = {},
}) {
  const keyName = requireText(name, "updater key name");
  const privateKeyPath = path.join(
    requireText(workspace?.keysDirectory, "workspace keys directory"), `${keyName}.key`,
  );
  const publicKeyPath = `${privateKeyPath}.pub`;
  const execute = boundaries.execute ?? runAcceptanceCommand;
  await execute(
    "npm",
    ["run", "tauri", "--", "signer", "generate", "--ci", "--password",
      requireText(password, "updater key password"), "--write-keys", privateKeyPath],
    `generate ${keyName} updater key`,
    { cwd: studioRoot, environment: { ...process.env, CI: "true" } },
  );
  const publicKey = await loadGeneratedUpdaterPublicKey(publicKeyPath, {
    readFile: boundaries.readFile ?? readFile,
  });
  return { publicKey, privateKeyPath, publicKeyPath, password };
}

function availableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new PackagedUpdateEnvironmentError(
          "could not allocate a loopback HTTPS port",
        ));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export async function createTrustedLoopbackTls({
  workspace,
  boundaries = {},
}) {
  const execute = boundaries.execute ?? runAcceptanceCommand;
  const allocatePort = boundaries.availablePort ?? availableLoopbackPort;
  const write = boundaries.writeFile ?? writeFile;
  const tlsDirectory = requireText(workspace?.tlsDirectory, "workspace TLS directory");
  const caKeyPath = path.join(tlsDirectory, "ca.key.pem");
  const caCertificatePath = path.join(tlsDirectory, "ca.cert.pem");
  const keyPath = path.join(tlsDirectory, "localhost.key.pem");
  const certificateRequestPath = path.join(tlsDirectory, "localhost.csr.pem");
  const certificatePath = path.join(tlsDirectory, "localhost.cert.pem");
  const certificateExtensionsPath = path.join(tlsDirectory, "localhost.ext");
  const certificateSerialPath = path.join(tlsDirectory, "ca.cert.srl");
  await write(certificateExtensionsPath, [
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "",
  ].join("\n"));

  const commandOptions = { cwd: tlsDirectory, environment: process.env };
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
  };

  await execute(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
      "-keyout", caKeyPath, "-out", caCertificatePath,
      "-subj", "/CN=Ticketry Packaged Update Acceptance CA", "-days", "1",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    ],
    "generate loopback certificate authority",
    commandOptions,
  );
  await execute(
    "openssl",
    [
      "req", "-newkey", "rsa:2048", "-sha256", "-nodes",
      "-keyout", keyPath, "-out", certificateRequestPath,
      "-subj", "/CN=localhost",
    ],
    "generate loopback TLS key and request",
    commandOptions,
  );
  await execute(
    "openssl",
    [
      "x509", "-req", "-in", certificateRequestPath,
      "-CA", caCertificatePath, "-CAkey", caKeyPath,
      "-CAserial", certificateSerialPath, "-CAcreateserial",
      "-out", certificatePath, "-days", "1", "-sha256",
      "-extfile", certificateExtensionsPath,
    ],
    "sign loopback TLS certificate",
    commandOptions,
  );
  const port = await allocatePort();
  return {
    origin: `https://127.0.0.1:${port}`,
    port,
    keyPath,
    certificatePath,
    caCertificatePath,
    dispose,
  };
}

function withoutAppleCredentials(environment) {
  const safe = { ...environment };
  for (const name of [
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_KEY",
    "APPLE_API_ISSUER",
    "APPLE_API_KEY_PATH",
  ]) {
    delete safe[name];
  }
  return safe;
}

function bundleRoot(targetDirectory) {
  return path.join(
    targetDirectory,
    "aarch64-apple-darwin",
    "release",
    "bundle",
    "macos",
  );
}

export async function buildPackagedUpdateArtifacts({
  plan,
  workspace,
  trustedUpdaterKey,
  wrongUpdaterKey,
  environment = process.env,
  boundaries = {},
}) {
  const execute = boundaries.execute ?? runAcceptanceCommand;
  const safeEnvironment = withoutAppleCredentials(environment);
  const versions = [
    ["A", plan?.versions?.versionA, workspace?.buildDirectories?.versionA],
    ["B", plan?.versions?.versionB, workspace?.buildDirectories?.versionB],
  ];
  for (const [label, version, targetDirectory] of versions) {
    const build = createPackagedUpdateBuildCommand({
      version,
      updaterPublicKey: trustedUpdaterKey?.publicKey,
      updaterPrivateKey: trustedUpdaterKey?.privateKeyPath,
      updaterPrivateKeyPassword: trustedUpdaterKey?.password,
      feedUrl: plan?.feed?.latestJsonUrl,
      environment: {
        ...safeEnvironment,
        CARGO_TARGET_DIR: requireText(
          targetDirectory,
          `version ${label} build directory`,
        ),
      },
    });
    await execute(
      build.command,
      build.args,
      `build packaged update version ${label}`,
      { cwd: studioRoot, environment: build.environment },
    );
  }

  const artifacts = await stagePackagedUpdateArtifacts({
    versionA: {
      version: plan.versions.versionA,
      bundleRoot: bundleRoot(workspace.buildDirectories.versionA),
    },
    versionB: {
      version: plan.versions.versionB,
      bundleRoot: bundleRoot(workspace.buildDirectories.versionB),
    },
    stagingRoot: workspace.artifactsDirectory,
    boundaries: boundaries.artifactBoundaries,
  });
  const wrongKeyArchive = path.join(
    workspace.artifactsDirectory,
    "wrong-key",
    path.basename(artifacts.versionBArchive),
  );
  const copy = boundaries.copy ?? cp;
  await mkdir(path.dirname(wrongKeyArchive), { recursive: true });
  await copy(artifacts.versionBArchive, wrongKeyArchive);
  const wrongKeySignature = await signArchiveWithWrongKey({
    archivePath: wrongKeyArchive,
    privateKeyPath: wrongUpdaterKey?.privateKeyPath,
    privateKeyPassword: wrongUpdaterKey?.password,
    runCommand: (command, args, label) => execute(
      command,
      args,
      label,
      { cwd: studioRoot, environment: safeEnvironment },
    ),
  });
  return { ...artifacts, wrongKeyArchive, wrongKeySignature };
}
