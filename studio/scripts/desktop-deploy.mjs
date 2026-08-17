import { spawn } from "node:child_process";
import { access, cp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadManifest, selectTargets } from "./release-build.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultInstallPath = "/Applications/Ticketry.app";

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: studioRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${code ?? signal})`));
    });
  });
}

export function stagedAppPath(manifest, target, root = studioRoot) {
  return path.join(
    root,
    "release-output",
    manifest.release_version,
    target.id,
    "Ticketry.app",
  );
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function replaceInstalledApp(
  source,
  destination = defaultInstallPath,
  {
    copy = cp,
    move = rename,
    remove = rm,
    pathExists = exists,
    inspect = stat,
  } = {},
) {
  let sourceDetails;
  try {
    sourceDetails = await inspect(source);
  } catch (error) {
    throw new Error(`built application is missing: ${source}`, { cause: error });
  }
  if (!sourceDetails.isDirectory()) {
    throw new Error(`built application is not an app bundle directory: ${source}`);
  }

  const staging = `${destination}.deploying-${process.pid}`;
  const backup = `${destination}.previous-${process.pid}`;
  await remove(staging, { recursive: true, force: true });
  await remove(backup, { recursive: true, force: true });
  try {
    await copy(source, staging, { recursive: true });
  } catch (error) {
    await remove(staging, { recursive: true, force: true }).catch(() => {});
    throw new Error(`could not stage ${source} for installation: ${error.message}`, { cause: error });
  }

  const hadInstalledApp = await pathExists(destination);
  try {
    if (hadInstalledApp) await move(destination, backup);
    await move(staging, destination);
  } catch (error) {
    await remove(staging, { recursive: true, force: true }).catch(() => {});
    if (hadInstalledApp && await pathExists(backup) && !(await pathExists(destination))) {
      await move(backup, destination).catch(() => {});
    }
    throw new Error(`could not replace ${destination}: ${error.message}`, { cause: error });
  }

  await remove(backup, { recursive: true, force: true });
}

export async function deploy({ execute = run, installPath = defaultInstallPath } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Ticketry desktop deployment is supported only on macOS");
  }

  const manifest = await loadManifest();
  const targets = selectTargets(manifest);
  if (targets.length !== 1) {
    throw new Error("local deployment requires exactly one release target");
  }
  const [target] = targets;

  await execute(
    "npm",
    ["run", "desktop:build", "--", "--target", target.id, "--allow-unsigned"],
    "unsigned local desktop build",
  );
  const source = stagedAppPath(manifest, target);
  await replaceInstalledApp(source, installPath);
  console.log(`Installed ${source} at ${installPath}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  deploy().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
