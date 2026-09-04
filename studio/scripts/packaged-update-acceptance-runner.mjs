import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

import { runPackagedUpdateScenario } from "./packaged-update-acceptance-driver.mjs";
import { startPackagedUpdateFeed } from "./packaged-update-feed.mjs";

async function startPackagedUpdateWebDriver(options) {
  const webDriver = await import("./packaged-update-webdriver.mjs");
  return webDriver.startPackagedUpdateWebDriver(options);
}

async function prepareInstallation({
  sourceAppPath,
  appPath,
  dataDirectory,
  home,
  evidenceDirectory,
}) {
  await Promise.all([
    mkdir(path.dirname(appPath), { recursive: true }),
    mkdir(dataDirectory, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(evidenceDirectory, { recursive: true }),
  ]);
  await cp(sourceAppPath, appPath, { recursive: true });
}

function scenarioPaths(workspace, artifacts, scenario) {
  const installationDirectory = path.join(
    workspace.installationsDirectory,
    scenario,
  );
  return {
    scenario,
    sourceAppPath: artifacts.versionAApp,
    appPath: path.join(
      installationDirectory,
      path.basename(artifacts.versionAApp),
    ),
    dataDirectory: path.join(installationDirectory, "data"),
    home: path.join(installationDirectory, "home"),
    evidenceDirectory: path.join(workspace.evidenceDirectory, scenario),
  };
}

function feedOptions({ plan, artifacts, tls, wrongKey }) {
  return {
    origin: tls.origin,
    port: tls.port,
    tls: {
      keyPath: tls.keyPath,
      certificatePath: tls.certificatePath,
    },
    archivePath: wrongKey
      ? artifacts.wrongKeyArchive
      : artifacts.versionBArchive,
    signaturePath: wrongKey
      ? artifacts.wrongKeySignature
      : artifacts.versionBSignature,
    release: {
      version: plan.versions.versionB,
      notes: plan.feed.latestJson.notes,
      publishedAt: plan.feed.latestJson.pub_date,
    },
  };
}

export async function startPackagedUpdateAcceptanceRunner({
  plan,
  workspace,
  artifacts,
  tls,
  feed,
  boundaries = {},
}) {
  const install = boundaries.prepareInstallation ?? prepareInstallation;
  const startFeed = boundaries.startFeed ?? startPackagedUpdateFeed;
  const startWebDriver = boundaries.startWebDriver
    ?? startPackagedUpdateWebDriver;
  const runScenario = boundaries.runScenario ?? runPackagedUpdateScenario;
  let activeDriver;
  let activeFeed = feed;
  let disposePromise;
  let hasRun = false;
  let disposed = false;

  async function releaseActive() {
    const driver = activeDriver;
    const feed = activeFeed;
    activeDriver = undefined;
    activeFeed = undefined;
    let failure;
    try {
      await driver?.dispose?.();
    } catch (error) {
      failure = error;
    }
    try {
      await feed?.dispose?.();
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  }

  async function startScenario(scenario) {
    const options = scenarioPaths(workspace, artifacts, scenario);
    await install(options);
    activeDriver = await startWebDriver({
      scenario,
      appPath: options.appPath,
      dataDirectory: options.dataDirectory,
      home: options.home,
      evidenceDirectory: options.evidenceDirectory,
      versionA: plan.versions.versionA,
      versionB: plan.versions.versionB,
      environment: {
        ...process.env,
        TICKETRY_DESKTOP_ACCEPTANCE_CA_CERT: tls.caCertificatePath,
      },
    });
    return runScenario(activeDriver);
  }

  async function runConnectedScenario(scenario, wrongKey) {
    const options = scenarioPaths(workspace, artifacts, scenario);
    await install(options);
    activeFeed ??= await startFeed(feedOptions({
      plan,
      artifacts,
      tls,
      wrongKey,
    }));
    activeDriver = await startWebDriver({
      scenario,
      appPath: options.appPath,
      dataDirectory: options.dataDirectory,
      home: options.home,
      evidenceDirectory: options.evidenceDirectory,
      versionA: plan.versions.versionA,
      versionB: plan.versions.versionB,
      environment: {
        ...process.env,
        TICKETRY_DESKTOP_ACCEPTANCE_CA_CERT: tls.caCertificatePath,
      },
    });
    try {
      const result = await runScenario(activeDriver);
      return Array.isArray(activeFeed?.requests)
        ? { ...result, feedRequests: [...activeFeed.requests] }
        : result;
    } finally {
      await releaseActive();
    }
  }

  return {
    async run() {
      if (hasRun || disposed) {
        throw new Error("packaged update acceptance runner can only run once");
      }
      hasRun = true;
      try {
        const positive = await runConnectedScenario("positive", false);
        const wrongKey = await runConnectedScenario("wrongKey", true);
        const unreachable = await startScenario("unreachable");
        return {
          target: "darwin-aarch64",
          positive,
          wrongKey,
          unreachable,
        };
      } finally {
        await releaseActive();
      }
    },

    dispose() {
      disposePromise ??= (async () => {
        disposed = true;
        await releaseActive();
      })();
      return disposePromise;
    },
  };
}
