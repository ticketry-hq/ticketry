import process from "node:process";

import {
  createPackagedUpdateAcceptancePlan,
  runPackagedUpdateAcceptance,
} from "./packaged-update-acceptance.mjs";
import {
  buildPackagedUpdateArtifacts,
  createPackagedUpdateWorkspace,
  createTrustedLoopbackTls,
  generateUpdaterKeyPair,
} from "./packaged-update-acceptance-environment.mjs";
import { startPackagedUpdateFeed } from "./packaged-update-feed.mjs";
import { startPackagedUpdateAcceptanceRunner } from "./packaged-update-acceptance-runner.mjs";
import { loadManifest } from "./release-build.mjs";

export class PackagedUpdateAcceptanceCommandError extends Error {}

export function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new PackagedUpdateAcceptanceCommandError(
      `release version must be a three-part semantic version: ${version}`,
    );
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

const defaultDependencies = {
  loadManifest,
  createWorkspace: createPackagedUpdateWorkspace,
  generateKeyPair: generateUpdaterKeyPair,
  createTls: createTrustedLoopbackTls,
  createPlan: createPackagedUpdateAcceptancePlan,
  buildArtifacts: buildPackagedUpdateArtifacts,
  startFeed: startPackagedUpdateFeed,
  startRunner: startPackagedUpdateAcceptanceRunner,
  runAcceptance: runPackagedUpdateAcceptance,
};

function feedOptions(plan, artifacts, tls) {
  return {
    origin: tls.origin,
    port: tls.port,
    tls: {
      keyPath: tls.keyPath,
      certificatePath: tls.certificatePath,
    },
    archivePath: artifacts.versionBArchive,
    signaturePath: artifacts.versionBSignature,
    release: {
      version: plan.versions.versionB,
      notes: plan.feed.latestJson.notes,
      publishedAt: plan.feed.latestJson.pub_date,
    },
  };
}

async function disposeResource(resource, failure) {
  try {
    await resource?.dispose?.();
    return failure;
  } catch (error) {
    return failure ?? error;
  }
}

export async function runPackagedUpdateAcceptanceCommand({
  environment = process.env,
  now = () => new Date(),
  log = console.log,
  dependencies = {},
} = {}) {
  const services = { ...defaultDependencies, ...dependencies };
  let workspace;
  let tls;
  let result;
  let failure;
  try {
    const manifest = await services.loadManifest();
    workspace = await services.createWorkspace({
      keep: environment.TICKETRY_KEEP_PACKAGED_UPDATE_ACCEPTANCE === "1",
    });
    const trustedUpdaterKey = await services.generateKeyPair({
      workspace,
      name: "trusted",
    });
    const wrongUpdaterKey = await services.generateKeyPair({
      workspace,
      name: "wrong",
    });
    tls = await services.createTls({ workspace });
    const plan = services.createPlan({
      manifest,
      versionA: manifest.release_version,
      versionB: nextPatchVersion(manifest.release_version),
      feedOrigin: tls.origin,
      publishedAt: now().toISOString(),
      trustedUpdaterKey,
      wrongUpdaterKey,
    });
    const nonOwningWorkspace = { ...workspace, dispose: async () => {} };
    const boundaries = {
      manifest,
      createWorkspace: async () => nonOwningWorkspace,
      buildArtifacts: async ({ plan: requestedPlan, workspace: requestedWorkspace }) =>
        services.buildArtifacts({
          plan: requestedPlan,
          workspace: requestedWorkspace,
          trustedUpdaterKey,
          wrongUpdaterKey,
          environment,
        }),
      startHttpsFeed: async ({ plan: requestedPlan, artifacts }) =>
        services.startFeed(feedOptions(requestedPlan, artifacts, tls)),
      startDriver: async ({
        plan: requestedPlan,
        workspace: requestedWorkspace,
        artifacts,
        feed,
      }) => services.startRunner({
        plan: requestedPlan,
        workspace: requestedWorkspace,
        artifacts,
        tls,
        feed,
      }),
    };
    result = await services.runAcceptance({ plan, boundaries });
  } catch (error) {
    failure = error;
  }

  failure = await disposeResource(tls, failure);
  failure = await disposeResource(workspace, failure);
  if (failure) {
    if (workspace?.retained) {
      log(`Packaged update acceptance artifacts retained: ${workspace.root}`);
    }
    throw failure;
  }
  log("Packaged update acceptance passed.");
  if (workspace.retained) {
    log(`Packaged update acceptance artifacts retained: ${workspace.root}`);
  }
  return result;
}
