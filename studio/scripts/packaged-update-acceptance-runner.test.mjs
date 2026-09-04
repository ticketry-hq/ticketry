import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  startPackagedUpdateAcceptanceRunner,
} from "./packaged-update-acceptance-runner.mjs";

const plan = {
  versions: { versionA: "1.4.0", versionB: "1.5.0" },
  feed: {
    latestJson: {
      notes: "Packaged update acceptance release.",
      pub_date: "2026-09-04T09:30:00.000Z",
    },
  },
};

const workspace = {
  installationsDirectory: "/acceptance/installations",
  evidenceDirectory: "/acceptance/evidence",
};

const artifacts = {
  versionAApp: "/acceptance/artifacts/A/Ticketry.app",
  versionBArchive: "/acceptance/artifacts/B/Ticketry.app.tar.gz",
  versionBSignature: "/acceptance/artifacts/B/Ticketry.app.tar.gz.sig",
  wrongKeyArchive: "/acceptance/artifacts/wrong/Ticketry.app.tar.gz",
  wrongKeySignature: "/acceptance/artifacts/wrong/Ticketry.app.tar.gz.sig",
};

const tls = {
  origin: "https://127.0.0.1:43117",
  port: 43117,
  keyPath: "/acceptance/tls/localhost.key.pem",
  certificatePath: "/acceptance/tls/localhost.cert.pem",
  caCertificatePath: "/acceptance/tls/ca.cert.pem",
};

test("runs the three update cases in isolated A installations on one feed origin", async (t) => {
  const originalMarker = process.env.TICKETRY_RUNNER_TEST_MARKER;
  process.env.TICKETRY_RUNNER_TEST_MARKER = "preserved";
  t.after(() => {
    if (originalMarker === undefined) {
      delete process.env.TICKETRY_RUNNER_TEST_MARKER;
    } else {
      process.env.TICKETRY_RUNNER_TEST_MARKER = originalMarker;
    }
  });
  const events = [];
  const feedCalls = [];
  const driverCalls = [];
  const scenarioResults = {
    positive: { outcome: "installed" },
    wrongKey: { outcome: "installation_refused" },
    unreachable: { outcome: "check_failed" },
  };
  const initialFeed = {
    origin: tls.origin,
    async dispose() {
      events.push("feed:dispose:trusted");
    },
  };

  const runner = await startPackagedUpdateAcceptanceRunner({
    plan,
    workspace,
    artifacts,
    tls,
    feed: initialFeed,
    boundaries: {
      prepareInstallation: async (options) => {
        events.push(`prepare:${options.scenario}`);
      },
      startFeed: async (options) => {
        const name = options.archivePath === artifacts.versionBArchive
          ? "trusted"
          : "wrong-key";
        feedCalls.push(options);
        events.push(`feed:start:${name}`);
        return {
          origin: tls.origin,
          async dispose() {
            events.push(`feed:dispose:${name}`);
          },
        };
      },
      startWebDriver: async (options) => {
        driverCalls.push(options);
        events.push(`driver:start:${options.scenario}`);
        return {
          scenario: options.scenario,
          async dispose() {
            events.push(`driver:dispose:${options.scenario}`);
          },
        };
      },
      runScenario: async (driver) => {
        events.push(`scenario:run:${driver.scenario}`);
        return scenarioResults[driver.scenario];
      },
    },
  });

  assert.deepEqual(await runner.run(), {
    target: "darwin-aarch64",
    positive: scenarioResults.positive,
    wrongKey: scenarioResults.wrongKey,
    unreachable: scenarioResults.unreachable,
  });
  await runner.dispose();
  await runner.dispose();

  assert.deepEqual(feedCalls, [
    {
      origin: tls.origin,
      port: tls.port,
      tls: {
        keyPath: tls.keyPath,
        certificatePath: tls.certificatePath,
      },
      archivePath: artifacts.wrongKeyArchive,
      signaturePath: artifacts.wrongKeySignature,
      release: {
        version: plan.versions.versionB,
        notes: plan.feed.latestJson.notes,
        publishedAt: plan.feed.latestJson.pub_date,
      },
    },
  ]);

  assert.deepEqual(driverCalls.map((call) => ({
    scenario: call.scenario,
    appPath: call.appPath,
    dataDirectory: call.dataDirectory,
    home: call.home,
    evidenceDirectory: call.evidenceDirectory,
    versionA: call.versionA,
    versionB: call.versionB,
    acceptanceCaCertificate:
      call.environment.TICKETRY_DESKTOP_ACCEPTANCE_CA_CERT,
    environmentMarker: call.environment.TICKETRY_RUNNER_TEST_MARKER,
  })), ["positive", "wrongKey", "unreachable"].map((scenario) => ({
    scenario,
    appPath: path.join(
      workspace.installationsDirectory,
      scenario,
      "Ticketry.app",
    ),
    dataDirectory: path.join(
      workspace.installationsDirectory,
      scenario,
      "data",
    ),
    home: path.join(workspace.installationsDirectory, scenario, "home"),
    evidenceDirectory: path.join(workspace.evidenceDirectory, scenario),
    versionA: plan.versions.versionA,
    versionB: plan.versions.versionB,
    acceptanceCaCertificate: tls.caCertificatePath,
    environmentMarker: "preserved",
  })));

  assert.deepEqual(events, [
    "prepare:positive",
    "driver:start:positive",
    "scenario:run:positive",
    "driver:dispose:positive",
    "feed:dispose:trusted",
    "prepare:wrongKey",
    "feed:start:wrong-key",
    "driver:start:wrongKey",
    "scenario:run:wrongKey",
    "driver:dispose:wrongKey",
    "feed:dispose:wrong-key",
    "prepare:unreachable",
    "driver:start:unreachable",
    "scenario:run:unreachable",
    "driver:dispose:unreachable",
  ]);

});

test("a failed scenario releases its driver and feed exactly once", async () => {
  const disposals = [];
  const runner = await startPackagedUpdateAcceptanceRunner({
    plan,
    workspace,
    artifacts,
    tls,
    boundaries: {
      prepareInstallation: async () => {},
      startFeed: async () => ({
        async dispose() {
          disposals.push("feed");
        },
      }),
      startWebDriver: async () => ({
        async dispose() {
          disposals.push("driver");
        },
      }),
      runScenario: async () => {
        throw new Error("positive scenario failed");
      },
    },
  });

  await assert.rejects(runner.run(), /positive scenario failed/);
  await runner.dispose();
  await runner.dispose();

  assert.deepEqual(disposals, ["driver", "feed"]);
});
