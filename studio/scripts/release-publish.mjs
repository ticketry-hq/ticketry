import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadManifest, selectTargets } from "./release-build.mjs";
import { runInstalledArtifactAcceptance } from "./installed-artifact-acceptance.mjs";

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

export async function publishRelease({ manifest, targets, driverPath, publishCommand, accept = runInstalledArtifactAcceptance, execute = run }) {
  if (!Array.isArray(publishCommand) || publishCommand.length === 0) {
    throw new ReleasePublicationError("MUXED_RELEASE_PUBLISH_COMMAND must be a JSON argv array");
  }
  for (const target of targets) {
    const appPath = path.join(
      studioRoot,
      "release-output",
      manifest.release_version,
      target.id,
      "Muxed Studio.app",
    );
    await accept({ bundlePath: appPath, driverPath });
  }
  await execute(publishCommand[0], publishCommand.slice(1));
}

async function main() {
  const targetIndex = process.argv.indexOf("--target");
  const requestedTarget = targetIndex === -1 ? "all" : process.argv[targetIndex + 1];
  if (!requestedTarget || process.argv.length > (targetIndex === -1 ? 2 : 4)) {
    throw new ReleasePublicationError("usage: release-publish.mjs [--target <manifest-target>|all]");
  }
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
    driverPath: process.env.MUXED_DESKTOP_ACCEPTANCE_DRIVER,
    publishCommand,
  });
  console.log(`Release ${manifest.release_version} published after installed-artifact acceptance.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
