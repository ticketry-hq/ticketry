import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { preparationRecordPath, repositoryRoot } from "./paths.mjs";

/**
 * Provenance for the prepared profiling artifacts.
 *
 * A profiling report is worthless if nobody can say which source it measured,
 * so `perf:run` refuses to profile a bundle that no longer matches the working
 * tree. The fingerprint covers committed blob identities *and* the contents of
 * uncommitted edits, because this repository is routinely profiled dirty.
 */
export const PREPARATION_SCHEMA_VERSION = 1;

/** Frontend inputs whose change invalidates the recorded bundle. */
export const FINGERPRINTED_PATHS = [
  "studio/src",
  "studio/index.html",
  "studio/package.json",
  "studio/vite.config.ts",
  "studio/vite.performance.config.ts",
  "studio/vite.proxy.ts",
  "studio/tailwind.config.ts",
  "studio/postcss.config.js",
  "package-lock.json",
];

function git(arguments_, { cwd = repositoryRoot } = {}) {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function computeSourceFingerprint({
  paths = FINGERPRINTED_PATHS,
  cwd = repositoryRoot,
  runGit = git,
  readFile = (file) => readFileSync(file),
} = {}) {
  const head = runGit(["rev-parse", "HEAD"], { cwd }).trim();
  const tracked = runGit(["ls-files", "-s", "--", ...paths], { cwd });
  const status = runGit(["status", "--porcelain", "--", ...paths], { cwd });
  const digest = createHash("sha256");
  digest.update(tracked);
  // Blob identities cover committed content. Anything the status output calls
  // modified, added or untracked is hashed from disk, so a dirty edit produces
  // a different fingerprint than the commit it sits on.
  const dirtyFiles = [];
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    const file = line.slice(3).trim().replace(/^"|"$/g, "");
    const absolute = path.join(cwd, file);
    dirtyFiles.push(file);
    digest.update(` ${file} `);
    try {
      digest.update(readFile(absolute));
    } catch {
      // Deleted in the working tree; the path alone already changed the hash.
      digest.update("<absent>");
    }
  }
  return {
    gitSha: head,
    dirty: dirtyFiles.length > 0,
    dirtyFiles: dirtyFiles.slice(0, 200),
    dirtyFileCount: dirtyFiles.length,
    fingerprintedPaths: [...paths],
    sourceFingerprint: digest.digest("hex"),
  };
}

export function writePreparationRecord(
  record,
  { recordPath = preparationRecordPath } = {},
) {
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return recordPath;
}

export function readPreparationRecord({ recordPath = preparationRecordPath } = {}) {
  if (!existsSync(recordPath)) return null;
  try {
    return JSON.parse(readFileSync(recordPath, "utf8"));
  } catch (error) {
    throw new Error(
      `the prepared-artifact record ${recordPath} is unreadable: ${error.message}`,
    );
  }
}

/**
 * Decide whether a recorded preparation still describes what would be
 * measured. Every mismatch is named, so the failure message is actionable.
 */
export function assessPreparation(record, {
  fingerprint,
  adapterProfile,
  adapterBinary,
  buildDirectory,
  exists = existsSync,
  stat = statSync,
}) {
  const reasons = [];
  if (!record) {
    reasons.push("no prepared build was recorded");
    return { current: false, reasons };
  }
  if (record.schemaVersion !== PREPARATION_SCHEMA_VERSION) {
    reasons.push(
      `preparation schema ${record.schemaVersion} does not match ${PREPARATION_SCHEMA_VERSION}`,
    );
  }
  if (record.source?.sourceFingerprint !== fingerprint.sourceFingerprint) {
    reasons.push("the frontend source fingerprint changed since the bundle was built");
  }
  if (record.adapter?.profile !== adapterProfile) {
    reasons.push(
      `the adapter was prepared in the ${record.adapter?.profile} profile, not ${adapterProfile}`,
    );
  }
  if (!exists(adapterBinary)) {
    reasons.push(`the prepared adapter binary ${adapterBinary} is missing`);
  } else if (record.adapter?.builtAtMs !== undefined) {
    const mtime = stat(adapterBinary).mtimeMs;
    if (mtime > record.adapter.builtAtMs + 1) {
      reasons.push("the adapter binary was rebuilt after preparation recorded it");
    }
  }
  if (!exists(path.join(buildDirectory, "index.html"))) {
    reasons.push(`the prepared bundle ${buildDirectory} is missing index.html`);
  }
  return { current: reasons.length === 0, reasons };
}

export function stalePreparationMessage(reasons) {
  return [
    "the prepared profiling artifacts are stale or missing:",
    ...reasons.map((reason) => `  - ${reason}`),
    "run: npm run perf:prepare --workspace @worktracker/studio",
    "or rerun with --allow-stale-build to profile the recorded bundle anyway",
  ].join("\n");
}
