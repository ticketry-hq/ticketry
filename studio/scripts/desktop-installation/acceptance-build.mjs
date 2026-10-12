import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { editionFeatureArguments, resolveEditionBuild } from "../edition-build-policy.mjs";

/**
 * Builds the test-only desktop application and the hook runner a fresh
 * installation copies beside it.
 *
 * The application is a debug Tauri build with the `desktop-acceptance`
 * feature, which alone embeds the WebDriver server. Setting
 * `TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD=1` reuses the existing binary.
 */
export const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const repositoryRoot = path.resolve(studioRoot, "..");

export function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

export function buildDesktopAcceptanceApplication({
  environment = process.env,
  run = runChecked,
  log = console.log,
} = {}) {
  // An invalid TICKETRY_EDITION fails here, before any build step.
  const editionBuild = resolveEditionBuild(environment);
  if (environment.TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD === "1") return;
  log(editionBuild.description);
  // CODING-1486 — the acceptance shell renders with native libghostty, a
  // default Cargo feature, so the pinned static library must exist first.
  run("bun", ["run", "libghostty:prepare"], { cwd: studioRoot, env: editionBuild.environment });
  run("bun", [
    "run",
    "tauri",
    "build",
    "--debug",
    "--no-bundle",
    ...editionFeatureArguments(editionBuild, ["desktop-acceptance"]),
  ], { cwd: studioRoot, env: editionBuild.environment });
}

export function buildHookRunner() {
  runChecked("cargo", [
    "build",
    "--locked",
    "--manifest-path",
    path.join(studioRoot, "src-tauri", "Cargo.toml"),
    "-p",
    "ticketry-hook",
    "--bin",
    "ticketry-hook",
  ]);
  return path.join(studioRoot, "src-tauri", "target", "debug", "ticketry-hook");
}
