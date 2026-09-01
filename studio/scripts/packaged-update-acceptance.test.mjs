import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PackagedUpdateAcceptanceError,
  assertPackagedUpdateAcceptanceResult,
  createPackagedUpdateAcceptancePlan,
  runPackagedUpdateAcceptance,
} from "./packaged-update-acceptance.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(
  await readFile(path.join(studioRoot, "release", "manifest.v1.json"), "utf8"),
);

const versionA = "0.2.0";
const versionB = "0.3.0";
const feedOrigin = "https://127.0.0.1:44321";
const publishedAt = "2026-08-31T12:00:00.000Z";
const trustedUpdaterKey = {
  publicKey: "throwaway updater public key",
  privateKeyPath: "/tmp/packaged-update-acceptance/trusted.key",
};
const wrongUpdaterKey = {
  publicKey: "wrong throwaway updater public key",
  privateKeyPath: "/tmp/packaged-update-acceptance/wrong.key",
};

function acceptancePlan(overrides = {}) {
  return createPackagedUpdateAcceptancePlan({
    manifest,
    versionA,
    versionB,
    feedOrigin,
    publishedAt,
    trustedUpdaterKey,
    wrongUpdaterKey,
    ...overrides,
  });
}

function passingResult() {
  return {
    target: "darwin-aarch64",
    positive: {
      outcome: "installed",
      fromVersion: versionA,
      toVersion: versionB,
      preserved: {
        workTracker: true,
        selectedWorkspace: true,
        preferences: true,
        approvedExecutablePaths: true,
        compatibleAgentLoginState: true,
      },
      lifecycle: {
        dataDirectoryLock: {
          releasedByVersion: versionA,
          reacquiredByVersion: versionB,
          clean: true,
        },
        strandedProcesses: [],
      },
    },
    wrongKey: {
      outcome: "installation_refused",
      error: {
        code: "update_signature_invalid",
        message: "Update rejected: invalid signature. Ticketry was not changed.",
        action: "Publish an archive signed by the trusted updater key and check again.",
        retryable: false,
      },
      app: { version: versionA, healthy: true },
      dataPreserved: true,
      lifecycle: {
        dataDirectoryLock: { ownerVersion: versionA, clean: true },
        strandedProcesses: [],
      },
    },
    unreachable: {
      outcome: "check_failed",
      error: {
        code: "update_feed_unreachable",
        message: "The stable channel update feed could not be reached.",
        action: "Check the connection and retry the update check.",
        retryable: true,
      },
      app: { version: versionA, healthy: true },
      dataPreserved: true,
      lifecycle: {
        dataDirectoryLock: { ownerVersion: versionA, clean: true },
        strandedProcesses: [],
      },
    },
  };
}

test("the local feed uses production-shaped HTTPS latest/download URLs", () => {
  const plan = acceptancePlan();

  assert.deepEqual(plan.feed, {
    latestJsonUrl: `${feedOrigin}/releases/latest/download/latest.json`,
    archiveUrl: `${feedOrigin}/releases/latest/download/Ticketry.app.tar.gz`,
    signatureUrl: `${feedOrigin}/releases/latest/download/Ticketry.app.tar.gz.sig`,
    latestJson: {
      version: versionB,
      notes: "Packaged update acceptance release.",
      pub_date: publishedAt,
      platforms: {
        "darwin-aarch64": {
          signature: "read from Ticketry.app.tar.gz.sig",
          url: `${feedOrigin}/releases/latest/download/Ticketry.app.tar.gz`,
        },
      },
    },
  });

  for (const url of [
    plan.feed.latestJsonUrl,
    plan.feed.archiveUrl,
    plan.feed.signatureUrl,
  ]) {
    assert.equal(new URL(url).protocol, "https:");
  }

  assert.throws(
    () => acceptancePlan({ feedOrigin: "http://127.0.0.1:44321" }),
    /HTTPS/i,
  );
});

test("version A and B builds trust the throwaway key and produce updater artifacts", () => {
  const plan = acceptancePlan();
  const expectedEndpoint = `${feedOrigin}/releases/latest/download/latest.json`;

  assert.deepEqual(plan.builds, {
    versionA: {
      version: versionA,
      features: ["native-libghostty", "desktop-acceptance"],
      tauriConfig: {
        version: versionA,
        bundle: {
          targets: ["app"],
          createUpdaterArtifacts: true,
        },
        plugins: {
          updater: {
            pubkey: trustedUpdaterKey.publicKey,
            endpoints: [expectedEndpoint],
          },
        },
      },
    },
    versionB: {
      version: versionB,
      features: ["native-libghostty", "desktop-acceptance"],
      tauriConfig: {
        version: versionB,
        bundle: {
          targets: ["app"],
          createUpdaterArtifacts: true,
        },
        plugins: {
          updater: {
            pubkey: trustedUpdaterKey.publicKey,
            endpoints: [expectedEndpoint],
          },
        },
      },
    },
  });
  assert.deepEqual(plan.archiveSigners, {
    positive: trustedUpdaterKey.privateKeyPath,
    wrongKey: wrongUpdaterKey.privateKeyPath,
  });
  assert.notEqual(plan.archiveSigners.positive, plan.archiveSigners.wrongKey);
});

test("the plan requires every manifest preservation guarantee", () => {
  const required = [
    "WorkTracker data",
    "preferences",
    "approved executable paths",
    "compatible agent login state",
  ];

  assert.deepEqual(acceptancePlan().preservationRequirements, [
    ...required,
    "selected workspace",
  ]);

  for (const missing of required) {
    const incompleteManifest = structuredClone(manifest);
    incompleteManifest.release_policy.data.preserve = required.filter(
      (entry) => entry !== missing,
    );

    assert.throws(
      () => acceptancePlan({ manifest: incompleteManifest }),
      (error) => error instanceof PackagedUpdateAcceptanceError
        && error.message.includes(missing),
    );
  }
});

test("the plan rejects every target other than packaged darwin arm64", () => {
  const invalidTargets = [
    { platform: "linux" },
    { architecture: "x86_64" },
    { build_architecture: "x64" },
    { rust_target: "x86_64-apple-darwin" },
  ];

  for (const targetPatch of invalidTargets) {
    const unsupportedManifest = structuredClone(manifest);
    Object.assign(unsupportedManifest.targets[0], targetPatch);

    assert.throws(
      () => acceptancePlan({ manifest: unsupportedManifest }),
      (error) => error instanceof PackagedUpdateAcceptanceError
        && /darwin arm64/i.test(error.message),
    );
  }
});

test("result evidence proves install, relaunch, preservation, and clean shutdown", () => {
  assert.doesNotThrow(() => assertPackagedUpdateAcceptanceResult(
    passingResult(),
    { manifest, versionA, versionB },
  ));

  const invalidResults = [
    ["installed", (result) => { result.positive.outcome = "check_failed"; }],
    ["version A", (result) => { result.positive.fromVersion = versionB; }],
    ["version B", (result) => { result.positive.toVersion = versionA; }],
    ["WorkTracker data", (result) => { result.positive.preserved.workTracker = false; }],
    ["selected workspace", (result) => { result.positive.preserved.selectedWorkspace = false; }],
    ["preferences", (result) => { result.positive.preserved.preferences = false; }],
    ["approved executable paths", (result) => {
      result.positive.preserved.approvedExecutablePaths = false;
    }],
    ["compatible agent login state", (result) => {
      result.positive.preserved.compatibleAgentLoginState = false;
    }],
    ["stranded process", (result) => {
      result.positive.lifecycle.strandedProcesses = ["ticketry-hook:42"];
    }],
    ["data-directory lock", (result) => {
      result.positive.lifecycle.dataDirectoryLock.clean = false;
    }],
    ["reacquired", (result) => {
      result.positive.lifecycle.dataDirectoryLock.reacquiredByVersion = versionA;
    }],
  ];

  for (const [expectedMessage, mutate] of invalidResults) {
    const result = passingResult();
    mutate(result);
    assert.throws(
      () => assertPackagedUpdateAcceptanceResult(
        result,
        { manifest, versionA, versionB },
      ),
      new RegExp(expectedMessage, "i"),
    );
  }
});

test("result evidence proves wrong-key and unreachable feeds leave version A healthy", () => {
  const invalidResults = [
    ["wrong-key refusal", (result) => { result.wrongKey.outcome = "installed"; }],
    ["update_signature_invalid", (result) => {
      result.wrongKey.error.code = "update_operation_failed";
    }],
    ["actionable", (result) => { result.wrongKey.error.action = ""; }],
    ["version A", (result) => { result.wrongKey.app.version = versionB; }],
    ["healthy", (result) => { result.wrongKey.app.healthy = false; }],
    ["preserved", (result) => { result.wrongKey.dataPreserved = false; }],
    ["unreachable refusal", (result) => { result.unreachable.outcome = "installed"; }],
    ["update_feed_unreachable", (result) => {
      result.unreachable.error.code = "update_check_failed";
    }],
    ["retryable", (result) => { result.unreachable.error.retryable = false; }],
    ["actionable", (result) => { result.unreachable.error.message = "   "; }],
    ["version A", (result) => { result.unreachable.app.version = versionB; }],
    ["healthy", (result) => { result.unreachable.app.healthy = false; }],
    ["preserved", (result) => { result.unreachable.dataPreserved = false; }],
  ];

  for (const [expectedMessage, mutate] of invalidResults) {
    const result = passingResult();
    mutate(result);
    assert.throws(
      () => assertPackagedUpdateAcceptanceResult(
        result,
        { manifest, versionA, versionB },
      ),
      new RegExp(expectedMessage, "i"),
    );
  }
});

test("the orchestrator cleans acquired resources when the acceptance driver fails", async () => {
  const liveResources = new Set();
  const acquire = (name, value) => {
    liveResources.add(name);
    return {
      ...value,
      async dispose() {
        liveResources.delete(name);
      },
    };
  };

  await assert.rejects(
    runPackagedUpdateAcceptance({
      plan: acceptancePlan(),
      boundaries: {
        createWorkspace: async () => acquire("workspace", { path: "/tmp/acceptance" }),
        buildArtifacts: async () => ({
          versionAApp: "/tmp/acceptance/A/Ticketry.app",
          versionBArchive: "/tmp/acceptance/B/Ticketry.app.tar.gz",
        }),
        startHttpsFeed: async () => acquire("feed", { origin: feedOrigin }),
        startDriver: async () => acquire("driver", {
          async run() {
            throw new Error("packaged update driver failed");
          },
        }),
      },
    }),
    /packaged update driver failed/,
  );

  assert.deepEqual([...liveResources], []);
});
