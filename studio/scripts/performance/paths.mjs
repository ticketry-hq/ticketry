import path from "node:path";
import { fileURLToPath } from "node:url";

/** Filesystem layout of one profiling run. Every other module imports it. */
export const studioRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const repositoryRoot = path.resolve(studioRoot, "..");

/** Optimized profiling bundle. Never `studio/dist`. */
export const performanceBuildDirectory = path.join(studioRoot, "dist-performance");
export const preparationRecordPath = path.join(
  performanceBuildDirectory,
  "preparation.json",
);

/** Already-ignored artifact root (see .gitignore: studio/test-results/). */
export const performanceResultsRoot = path.join(
  studioRoot,
  "test-results",
  "performance",
);
export const runLockPath = path.join(performanceResultsRoot, "run.lock");

export function runDirectory(runIdentifier) {
  return path.join(performanceResultsRoot, runIdentifier);
}

export function scenarioDirectory(runIdentifier, engine, scenario) {
  return path.join(runDirectory(runIdentifier), "scenarios", engine, scenario);
}

export function newRunIdentifier(now = new Date(), suffix = randomSuffix()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${suffix}`;
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export const adapterBinaryPath = (profile) =>
  path.join(
    studioRoot,
    "src-tauri",
    "target",
    profile,
    "ticketry_graphql_adapter",
  );
