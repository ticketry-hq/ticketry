import { fileURLToPath } from "node:url";

const REQUIRED_PRESERVATION = [
  "WorkTracker data",
  "preferences",
  "approved executable paths",
  "compatible agent login state",
];

export class PackagedUpdateAcceptanceError extends Error {}

function fail(message) {
  throw new PackagedUpdateAcceptanceError(message);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} is required`);
  return value;
}

function requireDarwinArm64(manifest) {
  const [target] = manifest?.targets ?? [];
  if (
    manifest?.targets?.length !== 1
    || target.platform !== "macos"
    || target.architecture !== "aarch64"
    || target.build_architecture !== "arm64"
    || target.rust_target !== "aarch64-apple-darwin"
  ) {
    fail("packaged update acceptance requires the darwin arm64 release target");
  }
  return target;
}

function buildPlan(version, publicKey, endpoint) {
  return {
    version,
    features: ["native-libghostty", "desktop-acceptance"],
    tauriConfig: {
      version,
      bundle: {
        targets: ["app"],
        createUpdaterArtifacts: true,
      },
      plugins: {
        updater: {
          pubkey: publicKey,
          endpoints: [endpoint],
        },
      },
    },
  };
}

export function createPackagedUpdateAcceptancePlan({
  manifest,
  versionA,
  versionB,
  feedOrigin,
  publishedAt,
  trustedUpdaterKey,
  wrongUpdaterKey,
}) {
  requireDarwinArm64(manifest);
  requireString(versionA, "version A");
  requireString(versionB, "version B");
  const origin = requireString(feedOrigin, "feed origin").replace(/\/$/, "");
  if (new URL(origin).protocol !== "https:") {
    fail("the packaged update acceptance feed must use HTTPS");
  }
  const preserve = manifest.release_policy?.data?.preserve ?? [];
  for (const requirement of REQUIRED_PRESERVATION) {
    if (!preserve.includes(requirement)) {
      fail(`release policy must preserve ${requirement}`);
    }
  }
  const publicKey = requireString(trustedUpdaterKey?.publicKey, "trusted updater public key");
  const trustedPrivateKey = requireString(
    trustedUpdaterKey?.privateKeyPath,
    "trusted updater private key path",
  );
  const wrongPrivateKey = requireString(
    wrongUpdaterKey?.privateKeyPath,
    "wrong updater private key path",
  );
  if (trustedPrivateKey === wrongPrivateKey) {
    fail("trusted and wrong updater keys must be distinct");
  }
  const downloadRoot = `${origin}/releases/latest/download`;
  const latestJsonUrl = `${downloadRoot}/latest.json`;
  const archiveUrl = `${downloadRoot}/Ticketry.app.tar.gz`;
  const signatureUrl = `${archiveUrl}.sig`;

  return {
    manifest,
    target: "darwin-aarch64",
    versions: { versionA, versionB },
    feed: {
      latestJsonUrl,
      archiveUrl,
      signatureUrl,
      latestJson: {
        version: versionB,
        notes: "Packaged update acceptance release.",
        pub_date: requireString(publishedAt, "publication date"),
        platforms: {
          "darwin-aarch64": {
            signature: "read from Ticketry.app.tar.gz.sig",
            url: archiveUrl,
          },
        },
      },
    },
    builds: {
      versionA: buildPlan(versionA, publicKey, latestJsonUrl),
      versionB: buildPlan(versionB, publicKey, latestJsonUrl),
    },
    archiveSigners: {
      positive: trustedPrivateKey,
      wrongKey: wrongPrivateKey,
    },
    preservationRequirements: [...REQUIRED_PRESERVATION, "selected workspace"],
  };
}

function requireTrue(value, message) {
  if (value !== true) fail(message);
}

function requireNoStrandedProcesses(lifecycle) {
  if (!Array.isArray(lifecycle?.strandedProcesses)) fail("stranded process evidence is missing");
  if (lifecycle.strandedProcesses.length > 0) fail("a stranded process remained after update");
}

function requireHealthyVersionA(result, versionA, label) {
  if (result?.app?.version !== versionA) fail(`${label} did not leave version A running`);
  requireTrue(result?.app?.healthy, `${label} did not leave version A healthy`);
  requireTrue(result?.dataPreserved, `${label} did not leave data preserved`);
  requireNoStrandedProcesses(result?.lifecycle);
  requireTrue(result?.lifecycle?.dataDirectoryLock?.clean, `${label} left an unclean data-directory lock`);
}

function requireActionable(error, label) {
  if (typeof error?.message !== "string" || error.message.trim() === "") {
    fail(`${label} error must be actionable`);
  }
}

export function assertPackagedUpdateAcceptanceResult(
  result,
  { manifest, versionA, versionB },
) {
  requireDarwinArm64(manifest);
  if (result?.target !== "darwin-aarch64") fail("result target must be darwin-aarch64");
  if (result?.positive?.outcome !== "installed") {
    fail(`positive update was not installed: ${JSON.stringify(result?.positive)}`);
  }
  if (result.positive.fromVersion !== versionA) fail("positive result did not start at version A");
  if (result.positive.toVersion !== versionB) fail("positive result did not relaunch version B");
  const preservation = [
    ["workTracker", "WorkTracker data"],
    ["selectedWorkspace", "selected workspace"],
    ["preferences", "preferences"],
    ["approvedExecutablePaths", "approved executable paths"],
    ["compatibleAgentLoginState", "compatible agent login state"],
  ];
  for (const [field, label] of preservation) {
    requireTrue(result.positive.preserved?.[field], `${label} was not preserved`);
  }
  requireNoStrandedProcesses(result.positive.lifecycle);
  const positiveLock = result.positive.lifecycle?.dataDirectoryLock;
  requireTrue(positiveLock?.clean, "data-directory lock was not cleanly released");
  if (positiveLock?.releasedByVersion !== versionA) fail("data-directory lock was not released by version A");
  if (positiveLock?.reacquiredByVersion !== versionB) fail("data-directory lock was not reacquired by version B");

  if (result?.wrongKey?.outcome !== "installation_refused") fail("wrong-key refusal was not observed");
  if (result.wrongKey.error?.code !== "update_signature_invalid") fail("wrong-key refusal omitted update_signature_invalid");
  requireActionable(result.wrongKey.error, "wrong-key refusal");
  requireHealthyVersionA(result.wrongKey, versionA, "wrong-key refusal");

  if (result?.unreachable?.outcome !== "check_failed") fail("unreachable refusal was not observed");
  if (result.unreachable.error?.code !== "update_feed_unreachable") fail("unreachable refusal omitted update_feed_unreachable");
  requireTrue(result.unreachable.error?.retryable, "unreachable feed error was not retryable");
  requireActionable(result.unreachable.error, "unreachable refusal");
  requireHealthyVersionA(result.unreachable, versionA, "unreachable refusal");
}

export async function runPackagedUpdateAcceptance({ plan, boundaries }) {
  const resources = [];
  try {
    const workspace = await boundaries.createWorkspace(plan);
    resources.push(workspace);
    const artifacts = await boundaries.buildArtifacts({ plan, workspace });
    const feed = await boundaries.startHttpsFeed({ plan, workspace, artifacts });
    resources.push(feed);
    const driver = await boundaries.startDriver({ plan, workspace, artifacts, feed });
    resources.push(driver);
    const result = await driver.run({ plan, workspace, artifacts, feed });
    assertPackagedUpdateAcceptanceResult(result, {
      manifest: boundaries.manifest ?? plan.manifest,
      versionA: plan.versions.versionA,
      versionB: plan.versions.versionB,
    });
    return result;
  } finally {
    for (const resource of resources.reverse()) {
      await resource?.dispose?.();
    }
  }
}

export function parsePackagedUpdateAcceptanceArguments(arguments_) {
  if (arguments_.length > 0) {
    fail(`Unknown packaged update acceptance option: ${arguments_[0]}`);
  }
  return {};
}

export async function runPackagedUpdateAcceptanceMain({
  arguments_ = process.argv.slice(2),
  runCommand,
} = {}) {
  parsePackagedUpdateAcceptanceArguments(arguments_);
  const execute = runCommand ?? (await import(
    "./packaged-update-acceptance-command.mjs"
  )).runPackagedUpdateAcceptanceCommand;
  return execute();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPackagedUpdateAcceptanceMain().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
