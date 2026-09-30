import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPackagedUpdateArtifacts,
  createPackagedUpdateWorkspace,
  createTrustedLoopbackTls,
  generateUpdaterKeyPair,
} from "./packaged-update-acceptance-environment.mjs";

test("a disposable packaged-update workspace owns the run directories", async () => {
  const workspace = await createPackagedUpdateWorkspace({ temporaryRoot: tmpdir() });

  try {
    assert.match(path.basename(workspace.root), /^ticketry-packaged-update-/);
    for (const directory of [
      workspace.keysDirectory,
      workspace.tlsDirectory,
      workspace.artifactsDirectory,
      workspace.installationsDirectory,
      workspace.evidenceDirectory,
      workspace.buildDirectories.versionA,
      workspace.buildDirectories.versionB,
    ]) {
      await access(directory);
      assert.equal(path.relative(workspace.root, directory).startsWith(".."), false);
    }
  } finally {
    await workspace.dispose();
  }

  await assert.rejects(access(workspace.root));
});

test("updater key generation returns the plan metadata without production credentials", async (t) => {
  const workspace = await createPackagedUpdateWorkspace({ temporaryRoot: tmpdir() });
  t.after(() => workspace.dispose());
  const commands = [];

  const key = await generateUpdaterKeyPair({
    workspace,
    name: "trusted",
    password: "acceptance-password",
    boundaries: {
      execute: async (...call) => commands.push(call),
      readFile: async () => "\nthrowaway-public-key\n",
    },
  });

  assert.deepEqual(key, {
    publicKey: "throwaway-public-key",
    privateKeyPath: path.join(workspace.keysDirectory, "trusted.key"),
    publicKeyPath: path.join(workspace.keysDirectory, "trusted.key.pub"),
    password: "acceptance-password",
  });
  assert.deepEqual(commands[0].slice(0, 3), [
    "npm",
    [
      "run", "tauri", "--", "signer", "generate", "--ci",
      "--password", "acceptance-password", "--write-keys", key.privateKeyPath,
    ],
    "generate trusted updater key",
  ]);
});

test("loopback TLS generates a private CA without mutating macOS keychains", async (t) => {
  const workspace = await createPackagedUpdateWorkspace({ temporaryRoot: tmpdir() });
  t.after(() => workspace.dispose());
  const commands = [];

  const tls = await createTrustedLoopbackTls({
    workspace,
    boundaries: {
      availablePort: async () => 43117,
      execute: async (command, args, label) => {
        commands.push({ command, args, label });
      },
    },
  });

  assert.equal(tls.origin, "https://127.0.0.1:43117");
  assert.equal(tls.port, 43117);
  assert.equal(tls.keyPath, path.join(workspace.tlsDirectory, "localhost.key.pem"));
  assert.equal(tls.certificatePath, path.join(workspace.tlsDirectory, "localhost.cert.pem"));
  assert.equal(tls.caCertificatePath, path.join(workspace.tlsDirectory, "ca.cert.pem"));
  assert.equal("keychainPath" in tls, false);
  assert.deepEqual(commands.map(({ label }) => label), [
    "generate loopback certificate authority",
    "generate loopback TLS key and request",
    "sign loopback TLS certificate",
  ]);
  assert.equal(commands.some(({ command }) => command === "security"), false);

  await tls.dispose();
  await tls.dispose();
  assert.equal(commands.some(({ command }) => command === "security"), false);
  assert.equal(commands.length, 3);
});

test("A and B build in isolated target directories and stage both signature cases", async (t) => {
  const workspace = await createPackagedUpdateWorkspace({ temporaryRoot: tmpdir() });
  t.after(() => workspace.dispose());
  const bundleRoot = (targetDirectory) => path.join(
    targetDirectory,
    "aarch64-apple-darwin",
    "release",
    "bundle",
    "macos",
  );
  const versionARoot = bundleRoot(workspace.buildDirectories.versionA);
  const versionBRoot = bundleRoot(workspace.buildDirectories.versionB);
  await Promise.all([
    mkdir(path.join(versionARoot, "Ticketry.app"), { recursive: true }),
    mkdir(versionBRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(versionARoot, "Ticketry.app", "marker"), "version A"),
    writeFile(path.join(versionBRoot, "Ticketry.app.tar.gz"), "version B archive"),
    writeFile(path.join(versionBRoot, "Ticketry.app.tar.gz.sig"), "trusted signature"),
  ]);
  const commands = [];
  const plan = {
    versions: { versionA: "1.4.0", versionB: "1.5.0" },
    feed: {
      latestJsonUrl: "https://127.0.0.1:43117/releases/latest/download/latest.json",
    },
  };

  const artifacts = await buildPackagedUpdateArtifacts({
    plan,
    workspace,
    trustedUpdaterKey: {
      publicKey: "trusted-public-key",
      privateKeyPath: "/keys/trusted.key",
      password: "trusted-password",
    },
    wrongUpdaterKey: {
      privateKeyPath: "/keys/wrong.key",
      password: "wrong-password",
    },
    environment: {
      PATH: "/usr/bin:/bin",
      APPLE_SIGNING_IDENTITY: "must not escape",
      APPLE_API_KEY: "must not escape",
    },
    boundaries: {
      execute: async (command, args, label, options) => {
        commands.push({ command, args, label, options });
      },
    },
  });

  assert.deepEqual(commands.slice(0, 2).map(({ label, options }) => ({
    label,
    target: options.environment.CARGO_TARGET_DIR,
    appleSigning: options.environment.APPLE_SIGNING_IDENTITY,
    appleApiKey: options.environment.APPLE_API_KEY,
  })), [
    {
      label: "build packaged update version A",
      target: workspace.buildDirectories.versionA,
      appleSigning: undefined,
      appleApiKey: undefined,
    },
    {
      label: "build packaged update version B",
      target: workspace.buildDirectories.versionB,
      appleSigning: undefined,
      appleApiKey: undefined,
    },
  ]);
  assert.equal(
    JSON.parse(commands[0].args[commands[0].args.indexOf("--config") + 1]).version,
    "1.4.0",
  );
  assert.equal(
    JSON.parse(commands[1].args[commands[1].args.indexOf("--config") + 1]).version,
    "1.5.0",
  );
  assert.equal(await readFile(artifacts.versionAApp + "/marker", "utf8"), "version A");
  assert.equal(await readFile(artifacts.versionBArchive, "utf8"), "version B archive");
  assert.equal(await readFile(artifacts.versionBSignature, "utf8"), "trusted signature");
  assert.equal(await readFile(artifacts.wrongKeyArchive, "utf8"), "version B archive");
  assert.equal(commands.at(-1).label, "sign wrong-key updater archive");
  assert.equal(artifacts.wrongKeySignature, `${artifacts.wrongKeyArchive}.sig`);
});
