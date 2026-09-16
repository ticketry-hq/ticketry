import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWebHookRunnerCommand } from "../../../scripts/web-dev.mjs";
import { ENGINES, parsePerformancePrepareOptions } from "./options.mjs";
import {
  adapterBinaryPath,
  performanceBuildDirectory,
  repositoryRoot,
  studioRoot,
} from "./paths.mjs";
import {
  computeSourceFingerprint,
  PREPARATION_SCHEMA_VERSION,
  writePreparationRecord,
} from "./provenance.mjs";

/**
 * Prepare everything a profiling run measures, before any measurement starts.
 *
 * A run must never build. Building during a timed scenario is exactly the
 * condition the September incident was confused by, so every compile happens
 * here and `perf:run` refuses to profile artifacts this step did not record.
 *
 * The frontend is a real optimized build with source maps, written to
 * `dist-performance` so it can never overwrite a `dist` another workflow owns.
 */
function run(command, arguments_, { cwd = studioRoot, label } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, arguments_, { cwd, stdio: "inherit" });
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return Date.now() - startedAt;
}

export function prepareHookRunner() {
  const build = buildWebHookRunnerCommand({ cwd: repositoryRoot });
  mkdirSync(path.dirname(build.output), { recursive: true });
  const durationMs = run(build.command, build.args, {
    cwd: repositoryRoot,
    label: "ticketry-hook build",
  });
  return { path: build.output, durationMs };
}

export function prepareAdapter(profile) {
  const arguments_ = [
    "build",
    "--locked",
    "--manifest-path",
    path.join("studio", "src-tauri", "Cargo.toml"),
    "-p",
    "ticketry-dev-tools",
    "--bin",
    "ticketry_graphql_adapter",
  ];
  if (profile === "release") arguments_.push("--release");
  const durationMs = run("cargo", arguments_, {
    cwd: repositoryRoot,
    label: `cargo build (${profile})`,
  });
  const binary = adapterBinaryPath(profile);
  return { profile, path: binary, builtAtMs: statSync(binary).mtimeMs, durationMs };
}

export function prepareFrontend() {
  const durationMs = run(
    "npm",
    ["exec", "--", "vite", "build", "--config", "vite.performance.config.ts"],
    { label: "vite build (performance)" },
  );
  return { outDir: performanceBuildDirectory, sourcemap: true, durationMs };
}

/**
 * Both profiling engines, downloaded once and reused. Playwright refuses to
 * launch a browser it has not installed, and discovering that halfway through
 * a WebKit run wastes a seeded runtime; `install` is idempotent and returns
 * immediately when the revisions are already present.
 */
export function prepareEngines() {
  const durationMs = run(
    "npm",
    ["exec", "--", "playwright", "install", ...ENGINES],
    { label: `playwright install ${ENGINES.join(" ")}` },
  );
  return { engines: [...ENGINES], durationMs };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parsePerformancePrepareOptions(argv);
  const startedAt = new Date().toISOString();
  const hook = prepareHookRunner();
  const adapter = prepareAdapter(options.adapterProfile);
  const frontend = prepareFrontend();
  const engines = prepareEngines();
  // The fingerprint is taken after the build so it describes the source the
  // bundle was produced from, not the source as it stood before compilation.
  const source = computeSourceFingerprint();
  const record = {
    schemaVersion: PREPARATION_SCHEMA_VERSION,
    preparedAt: startedAt,
    completedAt: new Date().toISOString(),
    source,
    adapter,
    hookRunner: hook,
    frontend,
    engines,
    node: process.version,
  };
  const recordPath = writePreparationRecord(record);
  console.log(
    `[performance] prepared bundle=${performanceBuildDirectory} `
    + `adapter=${adapter.path} fingerprint=${source.sourceFingerprint.slice(0, 12)}`
    + `${source.dirty ? ` (dirty worktree, ${source.dirtyFileCount} files)` : ""}`,
  );
  console.log(`[performance] provenance recorded at ${recordPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[performance] preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
