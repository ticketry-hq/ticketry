import assert from "node:assert/strict";
import test from "node:test";

import {
  createPackagedUpdateBuildCommand,
  loadGeneratedUpdaterPublicKey,
  signArchiveWithWrongKey,
  stagePackagedUpdateArtifacts,
} from "./packaged-update-build.mjs";

const VERSION_A = "0.2.0";
const VERSION_B = "0.3.0";
const FEED_URL = "https://127.0.0.1:44321/releases/latest/download/latest.json";
const TRUSTED_PUBLIC_KEY = "dW50cnVzdGVkIHRlc3QgdXBkYXRlciBwdWJsaWMga2V5";

function trustedBuild(overrides = {}) {
  return {
    version: VERSION_A,
    updaterPublicKey: TRUSTED_PUBLIC_KEY,
    updaterPrivateKey: "/keys/trusted-updater.key",
    updaterPrivateKeyPassword: "acceptance-only",
    feedUrl: FEED_URL,
    environment: {
      PATH: "/usr/bin:/bin",
      APPLE_SIGNING_IDENTITY: "Developer ID Application: Must Not Be Used",
      APPLE_ID: "release@example.test",
      APPLE_PASSWORD: "apple-password",
      APPLE_TEAM_ID: "APPLETEAM",
      APPLE_API_KEY: "notarization-api-key",
      APPLE_API_ISSUER: "notarization-api-issuer",
      APPLE_API_KEY_PATH: "/keys/notarization-api-key.p8",
    },
    ...overrides,
  };
}

test("arm64 acceptance builds use an unsigned Tauri config overlay and both runtime features", () => {
  const build = createPackagedUpdateBuildCommand(trustedBuild());
  const configIndex = build.args.indexOf("--config");
  const config = JSON.parse(build.args[configIndex + 1]);

  assert.equal(build.command, "npm");
  assert.deepEqual(build.args.slice(0, configIndex), [
    "run",
    "tauri",
    "--",
    "build",
    "--target",
    "aarch64-apple-darwin",
    "--features",
    "native-libghostty,desktop-acceptance",
  ]);
  assert.deepEqual(build.args.slice(configIndex + 2), ["--", "--bin", "ticketry"]);
  assert.deepEqual(config, {
    version: VERSION_A,
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
        pubkey: TRUSTED_PUBLIC_KEY,
        endpoints: [FEED_URL],
      },
    },
  });
  assert.deepEqual(build.environment, {
    PATH: "/usr/bin:/bin",
    CI: "true",
    TAURI_SIGNING_PRIVATE_KEY: "/keys/trusted-updater.key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "acceptance-only",
  });
  assert.equal(JSON.stringify(build).includes("Developer ID Application"), false);
  assert.equal(JSON.stringify(build).toLowerCase().includes("notar"), false);
});

test("acceptance builds refuse to run without updater signing credentials", () => {
  for (const missing of [
    { updaterPrivateKey: undefined },
    { updaterPrivateKeyPassword: undefined },
  ]) {
    assert.throws(
      () => createPackagedUpdateBuildCommand(trustedBuild(missing)),
      /updater signing/i,
    );
  }
});

test("the generated updater public key is loaded through the injected file boundary", async () => {
  const reads = [];
  const publicKey = await loadGeneratedUpdaterPublicKey(
    "/keys/trusted-updater.key.pub",
    {
      readFile: async (filePath, encoding) => {
        reads.push({ filePath, encoding });
        return `\n${TRUSTED_PUBLIC_KEY}\n`;
      },
    },
  );

  assert.equal(publicKey, TRUSTED_PUBLIC_KEY);
  assert.deepEqual(reads, [{
    filePath: "/keys/trusted-updater.key.pub",
    encoding: "utf8",
  }]);

  await assert.rejects(
    loadGeneratedUpdaterPublicKey("/keys/empty.pub", {
      readFile: async () => " \n",
    }),
    /public key/i,
  );
});

test("artifact staging copies only A's app and B's matching updater pair", async () => {
  const versionARoot = "/build/version-a/bundle/macos";
  const versionBRoot = "/build/version-b/bundle/macos";
  const listings = new Map([
    [versionARoot, [
      `${versionARoot}/Ticketry.app`,
      `${versionARoot}/Ticketry.app.tar.gz`,
      `${versionARoot}/Ticketry.app.tar.gz.sig`,
    ]],
    [versionBRoot, [
      `${versionBRoot}/Ticketry.app`,
      `${versionBRoot}/Ticketry.app.tar.gz.sig`,
      `${versionBRoot}/Ticketry.app.tar.gz`,
    ]],
  ]);
  const listedRoots = [];
  const copies = [];

  const artifacts = await stagePackagedUpdateArtifacts({
    versionA: { version: VERSION_A, bundleRoot: versionARoot },
    versionB: { version: VERSION_B, bundleRoot: versionBRoot },
    stagingRoot: "/acceptance/artifacts",
    boundaries: {
      listArtifacts: async (root) => {
        listedRoots.push(root);
        return listings.get(root);
      },
      copy: async (source, destination, options) => {
        copies.push({ source, destination, options });
      },
    },
  });

  assert.deepEqual(listedRoots, [versionARoot, versionBRoot]);
  assert.deepEqual(copies, [
    {
      source: `${versionARoot}/Ticketry.app`,
      destination: "/acceptance/artifacts/A/Ticketry.app",
      options: { recursive: true },
    },
    {
      source: `${versionBRoot}/Ticketry.app.tar.gz`,
      destination: "/acceptance/artifacts/B/Ticketry.app.tar.gz",
      options: undefined,
    },
    {
      source: `${versionBRoot}/Ticketry.app.tar.gz.sig`,
      destination: "/acceptance/artifacts/B/Ticketry.app.tar.gz.sig",
      options: undefined,
    },
  ]);
  assert.deepEqual(artifacts, {
    versionA: VERSION_A,
    versionB: VERSION_B,
    versionAApp: "/acceptance/artifacts/A/Ticketry.app",
    versionBArchive: "/acceptance/artifacts/B/Ticketry.app.tar.gz",
    versionBSignature: "/acceptance/artifacts/B/Ticketry.app.tar.gz.sig",
  });
});

test("artifact staging rejects shared roots and incomplete B updater pairs", async () => {
  const boundaries = {
    listArtifacts: async (root) => root.includes("version-a")
      ? [`${root}/Ticketry.app`]
      : [`${root}/Ticketry.app.tar.gz`],
    copy: async () => {
      throw new Error("copy must not start for invalid artifact inputs");
    },
  };

  await assert.rejects(
    stagePackagedUpdateArtifacts({
      versionA: { version: VERSION_A, bundleRoot: "/build/shared" },
      versionB: { version: VERSION_B, bundleRoot: "/build/shared" },
      stagingRoot: "/acceptance/artifacts",
      boundaries,
    }),
    /distinct.*version/i,
  );

  await assert.rejects(
    stagePackagedUpdateArtifacts({
      versionA: { version: VERSION_A, bundleRoot: "/build/version-a" },
      versionB: { version: VERSION_B, bundleRoot: "/build/version-b" },
      stagingRoot: "/acceptance/artifacts",
      boundaries,
    }),
    /archive.*signature/i,
  );
});

test("artifact staging validates version metadata before filesystem work", async () => {
  for (const versions of [
    {
      versionA: { bundleRoot: "/build/version-a" },
      versionB: { version: VERSION_B, bundleRoot: "/build/version-b" },
    },
    {
      versionA: { version: VERSION_A, bundleRoot: "/build/version-a" },
      versionB: { version: " ", bundleRoot: "/build/version-b" },
    },
  ]) {
    const operations = [];
    await assert.rejects(
      stagePackagedUpdateArtifacts({
        ...versions,
        stagingRoot: "/acceptance/artifacts",
        boundaries: {
          listArtifacts: async (root) => {
            operations.push({ operation: "list", root });
            return root.endsWith("version-a")
              ? [`${root}/Ticketry.app`]
              : [
                  `${root}/Ticketry.app.tar.gz`,
                  `${root}/Ticketry.app.tar.gz.sig`,
                ];
          },
          copy: async (source, destination) => {
            operations.push({ operation: "copy", source, destination });
          },
        },
      }),
      /version [AB]/i,
    );
    assert.deepEqual(operations, []);
  }
});

test("wrong-key signing uses the injected command runner and a separate archive", async () => {
  const commands = [];
  const signature = await signArchiveWithWrongKey({
    archivePath: "/acceptance/wrong-key/Ticketry.app.tar.gz",
    privateKeyPath: "/keys/wrong-updater.key",
    privateKeyPassword: "wrong-key-password",
    runCommand: async (command, args, label) => {
      commands.push({ command, args, label });
    },
  });

  assert.deepEqual(commands, [{
    command: "npm",
    args: [
      "run",
      "tauri",
      "--",
      "signer",
      "sign",
      "--private-key-path",
      "/keys/wrong-updater.key",
      "--password",
      "wrong-key-password",
      "/acceptance/wrong-key/Ticketry.app.tar.gz",
    ],
    label: "sign wrong-key updater archive",
  }]);
  assert.equal(signature, "/acceptance/wrong-key/Ticketry.app.tar.gz.sig");
  assert.notEqual(signature, "/acceptance/artifacts/B/Ticketry.app.tar.gz.sig");
});
