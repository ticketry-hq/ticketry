import assert from "node:assert/strict";
import test from "node:test";

import {
  nextPatchVersion,
  runPackagedUpdateAcceptanceCommand,
} from "./packaged-update-acceptance-command.mjs";

test("the command builds a real boundary set around the generated plan", async () => {
  const events = [];
  const logs = [];
  const manifest = {
    release_version: "1.4.9",
    targets: [{ id: "macos-aarch64" }],
  };
  const workspace = {
    root: "/acceptance",
    retained: false,
    async dispose() { events.push("workspace:dispose"); },
  };
  const tls = {
    origin: "https://127.0.0.1:43117",
    port: 43117,
    keyPath: "/acceptance/tls/localhost.key.pem",
    certificatePath: "/acceptance/tls/localhost.cert.pem",
    async dispose() { events.push("tls:dispose"); },
  };
  const trustedUpdaterKey = {
    publicKey: "trusted-public-key",
    privateKeyPath: "/acceptance/keys/trusted.key",
    password: "trusted-password",
  };
  const wrongUpdaterKey = {
    publicKey: "wrong-public-key",
    privateKeyPath: "/acceptance/keys/wrong.key",
    password: "wrong-password",
  };
  const plan = {
    manifest,
    versions: { versionA: "1.4.9", versionB: "1.4.10" },
    feed: {
      latestJsonUrl: `${tls.origin}/releases/latest/download/latest.json`,
      latestJson: {
        notes: "Packaged update acceptance release.",
        pub_date: "2026-09-04T10:00:00.000Z",
      },
    },
  };
  const artifacts = {
    versionAApp: "/acceptance/artifacts/A/Ticketry.app",
    versionBArchive: "/acceptance/artifacts/B/Ticketry.app.tar.gz",
    versionBSignature: "/acceptance/artifacts/B/Ticketry.app.tar.gz.sig",
  };
  const feed = { origin: tls.origin };
  const runner = { run: async () => ({ target: "darwin-aarch64" }) };
  const calls = {};

  const result = await runPackagedUpdateAcceptanceCommand({
    environment: {},
    now: () => new Date("2026-09-04T10:00:00.000Z"),
    log: (message) => logs.push(message),
    dependencies: {
      loadManifest: async () => manifest,
      createWorkspace: async (options) => {
        calls.workspaceOptions = options;
        return workspace;
      },
      generateKeyPair: async ({ name }) => name === "trusted"
        ? trustedUpdaterKey
        : wrongUpdaterKey,
      createTls: async () => tls,
      createPlan: (options) => {
        calls.planOptions = options;
        return plan;
      },
      buildArtifacts: async (options) => {
        calls.buildOptions = options;
        return artifacts;
      },
      startFeed: async (options) => {
        calls.feedOptions = options;
        return feed;
      },
      startRunner: async (options) => {
        calls.runnerOptions = options;
        return runner;
      },
      runAcceptance: async ({ plan: receivedPlan, boundaries }) => {
        calls.runBoundaries = boundaries;
        const receivedWorkspace = await boundaries.createWorkspace(receivedPlan);
        const receivedArtifacts = await boundaries.buildArtifacts({
          plan: receivedPlan,
          workspace: receivedWorkspace,
        });
        const receivedFeed = await boundaries.startHttpsFeed({
          plan: receivedPlan,
          workspace: receivedWorkspace,
          artifacts: receivedArtifacts,
        });
        const receivedRunner = await boundaries.startDriver({
          plan: receivedPlan,
          workspace: receivedWorkspace,
          artifacts: receivedArtifacts,
          feed: receivedFeed,
        });
        return receivedRunner.run();
      },
    },
  });

  assert.deepEqual(result, { target: "darwin-aarch64" });
  assert.deepEqual(calls.planOptions, {
    manifest,
    versionA: "1.4.9",
    versionB: "1.4.10",
    feedOrigin: tls.origin,
    publishedAt: "2026-09-04T10:00:00.000Z",
    trustedUpdaterKey,
    wrongUpdaterKey,
  });
  assert.equal(calls.buildOptions.plan, plan);
  assert.equal(calls.buildOptions.workspace.root, workspace.root);
  assert.equal(calls.buildOptions.trustedUpdaterKey, trustedUpdaterKey);
  assert.equal(calls.buildOptions.wrongUpdaterKey, wrongUpdaterKey);
  assert.deepEqual(calls.buildOptions.environment, {});
  assert.deepEqual(calls.feedOptions, {
    origin: tls.origin,
    port: tls.port,
    tls: { keyPath: tls.keyPath, certificatePath: tls.certificatePath },
    archivePath: artifacts.versionBArchive,
    signaturePath: artifacts.versionBSignature,
    release: {
      version: plan.versions.versionB,
      notes: plan.feed.latestJson.notes,
      publishedAt: plan.feed.latestJson.pub_date,
    },
  });
  assert.equal(calls.runnerOptions.feed, feed);
  assert.equal(calls.runnerOptions.tls, tls);
  assert.equal(calls.runBoundaries.manifest, manifest);
  assert.deepEqual(events, ["tls:dispose", "workspace:dispose"]);
  assert.deepEqual(logs, ["Packaged update acceptance passed."]);
});

test("retention preserves files but always removes temporary TLS trust", async () => {
  const events = [];
  let workspaceOptions;

  await assert.rejects(
    runPackagedUpdateAcceptanceCommand({
      environment: { TICKETRY_KEEP_PACKAGED_UPDATE_ACCEPTANCE: "1" },
      log: () => {},
      dependencies: {
        loadManifest: async () => ({ release_version: "2.0.0" }),
        createWorkspace: async (options) => {
          workspaceOptions = options;
          return {
            root: "/retained",
            retained: true,
            async dispose() { events.push("workspace:dispose"); },
          };
        },
        generateKeyPair: async ({ name }) => ({
          publicKey: `${name}-public`,
          privateKeyPath: `/retained/${name}.key`,
          password: `${name}-password`,
        }),
        createTls: async () => ({
          origin: "https://127.0.0.1:43118",
          async dispose() { events.push("tls:dispose"); },
        }),
        createPlan: (options) => ({
          manifest: options.manifest,
          versions: { versionA: options.versionA, versionB: options.versionB },
          feed: { latestJson: {} },
        }),
        runAcceptance: async () => { throw new Error("scenario failed"); },
      },
    }),
    /scenario failed/,
  );

  assert.deepEqual(workspaceOptions, { keep: true });
  assert.deepEqual(events, ["tls:dispose", "workspace:dispose"]);
});

test("the default B version is the next patch release", () => {
  assert.equal(nextPatchVersion("0.2.0"), "0.2.1");
  assert.equal(nextPatchVersion("12.4.99"), "12.4.100");
  assert.throws(() => nextPatchVersion("next"), /semantic version/i);
});
