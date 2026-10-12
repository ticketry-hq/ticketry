import {
  chmodSync,
  copyFileSync,
  constants as fsConstants,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { studioRoot } from "./acceptance-build.mjs";

/**
 * The directories of one disposable desktop installation, all under a single
 * temporary root so cleanup is one removal.
 */
export function createInstallationLayout() {
  const root = mkdtempSync("/private/tmp/ticketry-desktop-e2e-");
  const layout = {
    root,
    artifacts: path.join(root, "artifacts"),
    applicationDirectory: path.join(root, "app"),
    workspaceDirectory: path.join(root, "workspace"),
    tmuxDirectory: path.join(root, "tmux"),
    runtimeTempDirectory: path.join(root, "runtime-temp"),
    toolDirectory: path.join(root, "bin"),
    dataDirectory: path.join(root, "data"),
    codexHome: path.join(root, "codex-settings"),
  };
  try {
    for (const directory of [
      layout.artifacts,
      layout.applicationDirectory,
      layout.workspaceDirectory,
      layout.tmuxDirectory,
      layout.runtimeTempDirectory,
    ]) {
      mkdirSync(directory);
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return layout;
}

/**
 * Copies the built application into the installation first, so a missing
 * binary fails before the hook runner build, then the hook runner that
 * `provisionTools` returns.
 */
export function installApplication(layout, { binary, provisionTools }) {
  const installedBinary = path.join(layout.applicationDirectory, "ticketry");
  const installedHook = path.join(layout.applicationDirectory, "ticketry-hook");
  copyFileSync(binary, installedBinary, fsConstants.COPYFILE_FICLONE);
  copyFileSync(provisionTools(), installedHook);
  chmodSync(installedBinary, 0o755);
  chmodSync(installedHook, 0o755);
  stageNativeGhosttyResources(layout.applicationDirectory);
  return { binary: installedBinary, hook: installedHook };
}

/**
 * CODING-1486 — native libghostty reads its configuration and pinned runtime
 * resources through NSBundle, which for an unbundled executable resolves to the
 * directory holding it. This harness runs a copy of the built binary from a
 * temporary directory, so the resources have to travel with it; without them
 * native initialization fails and the shell silently renders with xterm.
 */
function stageNativeGhosttyResources(applicationDirectory) {
  copyFileSync(
    path.join(studioRoot, "src-tauri", "native", "ticketry-ghostty.conf"),
    path.join(applicationDirectory, "ticketry-ghostty.conf"),
  );
  const resources = path.join(studioRoot, "src-tauri", "vendor", "libghostty", "resources");
  for (const resource of ["ghostty", "terminfo"]) {
    cpSync(
      path.join(resources, resource),
      path.join(applicationDirectory, resource),
      { recursive: true },
    );
  }
}
