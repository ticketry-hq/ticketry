import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadManifest, selectTargets } from "./release-build.mjs";
import {
  bundledAcceptanceDriverPath,
  runInstalledArtifactAcceptance,
} from "./installed-artifact-acceptance.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));

export class ReleasePublicationError extends Error {}

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: studioRoot, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new ReleasePublicationError(`publication command failed (${code ?? signal})`));
    });
  });
}

async function loadReleaseMetadata(manifest, target) {
  const metadataPath = path.join(
    studioRoot,
    "release-output",
    manifest.release_version,
    target.id,
    "release-metadata.json",
  );
  try {
    return JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    throw new ReleasePublicationError(
      `could not read release metadata for ${target.id}: ${error.message}`,
    );
  }
}

function assertPublishableSigningStatus(target, metadata, acknowledgeUnsigned) {
  if (typeof metadata?.signed !== "boolean" || typeof metadata?.notarized !== "boolean") {
    throw new ReleasePublicationError(
      `release metadata for ${target.id} must explicitly declare signed and notarized booleans`,
    );
  }
  if (metadata.signed !== metadata.notarized) {
    throw new ReleasePublicationError(
      `release metadata for ${target.id} has inconsistent signing status: signed=${metadata.signed}, notarized=${metadata.notarized}`,
    );
  }
  if (!metadata.signed && !acknowledgeUnsigned) {
    throw new ReleasePublicationError(
      `refusing to publish unsigned artifact for ${target.id}; pass --acknowledge-unsigned to acknowledge it explicitly`,
    );
  }
}

export async function publishRelease({
  manifest,
  targets,
  driverPath,
  publishCommand,
  acknowledgeUnsigned = false,
  accept = runInstalledArtifactAcceptance,
  execute = run,
  readMetadata = loadReleaseMetadata,
}) {
  if (!Array.isArray(publishCommand) || publishCommand.length === 0) {
    throw new ReleasePublicationError("MUXED_RELEASE_PUBLISH_COMMAND must be a JSON argv array");
  }
  for (const target of targets) {
    const metadata = await readMetadata(manifest, target);
    assertPublishableSigningStatus(target, metadata, acknowledgeUnsigned);
  }
  for (const target of targets) {
    const appPath = path.join(
      studioRoot,
      "release-output",
      manifest.release_version,
      target.id,
      "Ticketry.app",
    );
    await accept({ bundlePath: appPath, driverPath });
  }
  await execute(publishCommand[0], publishCommand.slice(1));
}

export function parseArguments(arguments_) {
  let requestedTarget = "all";
  let acknowledgeUnsigned = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--target") {
      requestedTarget = arguments_[index + 1];
      index += 1;
    } else if (argument === "--acknowledge-unsigned") {
      acknowledgeUnsigned = true;
    } else {
      throw new ReleasePublicationError(`unknown release publish option: ${argument}`);
    }
  }
  if (!requestedTarget) {
    throw new ReleasePublicationError("--target requires a manifest target id or all");
  }
  return { requestedTarget, acknowledgeUnsigned };
}

async function main() {
  const { requestedTarget, acknowledgeUnsigned } = parseArguments(process.argv.slice(2));
  let publishCommand;
  try {
    publishCommand = JSON.parse(process.env.MUXED_RELEASE_PUBLISH_COMMAND ?? "");
  } catch {
    throw new ReleasePublicationError("MUXED_RELEASE_PUBLISH_COMMAND must be a JSON argv array");
  }
  const manifest = await loadManifest();
  await publishRelease({
    manifest,
    targets: selectTargets(manifest, requestedTarget),
    driverPath: process.env.MUXED_DESKTOP_ACCEPTANCE_DRIVER ?? bundledAcceptanceDriverPath,
    publishCommand,
    acknowledgeUnsigned,
  });
  console.log(`Release ${manifest.release_version} published after installed-artifact acceptance.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
