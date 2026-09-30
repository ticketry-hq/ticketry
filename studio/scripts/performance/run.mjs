import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ARTIFACTS, createRunMetadata, RUN_FILES } from "../../performance/report/schema.mjs";
import { summarizeScenario } from "../../performance/report/summarize.mjs";
import { renderRunMarkdown } from "../../performance/report/markdown.mjs";
import { assessHostNoise, createHostLoadSampler, sampleHostLoad } from "./host-load.mjs";
import { parsePerformanceRunOptions, SCENARIOS } from "./options.mjs";
import {
  adapterBinaryPath,
  newRunIdentifier,
  performanceBuildDirectory,
  runDirectory,
  runLockPath,
  scenarioDirectory,
  studioRoot,
} from "./paths.mjs";
import {
  assessPreparation,
  computeSourceFingerprint,
  readPreparationRecord,
  stalePreparationMessage,
} from "./provenance.mjs";
import { acquireRunLock } from "./run-lock.mjs";
import { startPerformanceRuntime } from "./server.mjs";

/**
 * One profiling run, end to end.
 *
 * The command owns the order everything happens in: refuse a stale build,
 * take the checkout's run lock, open an isolated runtime, hand Playwright a
 * ready app, then tear down only what it started. Nothing is built while a
 * scenario is being timed, and no unrelated build, test or user process is
 * ever stopped — a noisy host is labelled in the report instead.
 */
const require = createRequire(import.meta.url);

function machineDescription() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
  };
}

function playwrightVersion() {
  try {
    return require("@playwright/test/package.json").version;
  } catch {
    return null;
  }
}

async function runPlaywright(options, environment) {
  const child = spawn(
    "npm",
    [
      "exec",
      "--",
      "playwright",
      "test",
      "--config",
      "playwright.performance.config.ts",
      "--project",
      options.engine,
    ],
    { cwd: studioRoot, env: environment, stdio: "inherit" },
  );
  const [code] = await once(child, "exit");
  return code ?? 1;
}

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

function collectArtifacts(directory) {
  return Object.values(ARTIFACTS)
    .map((name) => path.join(directory, name))
    .filter((file) => existsSync(file));
}

function buildReport({ metadata, options }) {
  const scenarios = [];
  const cpuSummaries = [];
  const manifest = { runIdentifier: metadata.runIdentifier, scenarios: {}, runFiles: {} };
  for (const scenario of options.scenarios) {
    const directory = scenarioDirectory(metadata.runIdentifier, options.engine, scenario);
    const observations = readJson(path.join(directory, ARTIFACTS.observations));
    manifest.scenarios[scenario] = {
      directory,
      artifacts: collectArtifacts(directory),
      // A scenario whose observations are missing failed before it could write
      // them. It is listed as missing rather than omitted.
      recorded: Boolean(observations),
    };
    if (!observations) {
      scenarios.push({
        scenario,
        engine: options.engine,
        status: "missing",
        timings: {},
        failures: ["the scenario wrote no observations; see the Playwright output"],
        operations: {},
        parameters: {},
        retention: { value: null, reason: "no observations were recorded" },
      });
      continue;
    }
    scenarios.push(summarizeScenario({ ...observations, scenario, engine: options.engine }));
    const cpu = readJson(path.join(directory, ARTIFACTS.cpuSummary));
    if (cpu) cpuSummaries.push({ scenario, ...cpu });
  }
  const engineVersion = scenarios
    .map((scenario) => scenario.engineVersion)
    .find((version) => typeof version === "string") ?? null;
  return { scenarios, cpuSummaries, manifest, engineVersion };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parsePerformanceRunOptions(argv);
  const runIdentifier = options.runIdentifier ?? newRunIdentifier();
  const directory = runDirectory(runIdentifier);
  mkdirSync(directory, { recursive: true });

  const fingerprint = computeSourceFingerprint();
  const preparation = readPreparationRecord();
  const freshness = assessPreparation(preparation, {
    fingerprint,
    adapterProfile: options.adapterProfile,
    adapterBinary: adapterBinaryPath(options.adapterProfile),
    buildDirectory: performanceBuildDirectory,
  });
  if (!freshness.current && !options.allowStaleBuild) {
    throw new Error(stalePreparationMessage(freshness.reasons));
  }
  if (!freshness.current) {
    console.warn(
      `[performance] profiling a stale build on request:\n${
        freshness.reasons.map((reason) => `  - ${reason}`).join("\n")
      }`,
    );
  }

  const lock = acquireRunLock({ lockPath: runLockPath, runIdentifier });
  const sampler = createHostLoadSampler({ intervalMs: 1_000 });
  let runtime = null;
  let exitCode = 0;
  const stop = async () => {
    await runtime?.stop();
    lock.release();
  };
  const handleSignal = (signal) => {
    void stop().finally(() => process.kill(process.pid, signal));
  };
  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  try {
    const startingLoad = sampleHostLoad();
    const startingNoise = assessHostNoise([startingLoad]);
    if (startingNoise.noisy && !options.allowNoisyHost) {
      console.warn(
        `[performance] the host is already busy; measurements will be labelled noisy:\n${
          startingNoise.reasons.map((reason) => `  - ${reason}`).join("\n")
        }\n[performance] nothing was stopped. Rerun on an idle host, or pass `
        + "--allow-noisy-host to silence this warning.",
      );
    }
    sampler.start();
    runtime = await startPerformanceRuntime({
      adapterProfile: options.adapterProfile,
      requestedFrontendPort: options.frontendPort,
      requestedAdapterPort: options.adapterPort,
    });
    console.log(
      `[performance] run ${runIdentifier} app=${runtime.baseURL} `
      + `adapter=${runtime.adapterOrigin} data=${runtime.dataDirectory}`,
    );

    const metadata = createRunMetadata({
      runIdentifier,
      startedAt: new Date().toISOString(),
      engine: options.engine,
      engineVersion: null,
      playwrightVersion: playwrightVersion(),
      nodeVersion: process.version,
      buildMode: "optimized-vite-build-with-source-maps",
      adapterProfile: options.adapterProfile,
      headless: !options.headed,
      viewport: { width: 1440, height: 960 },
      dataset: { size: options.dataset, version: null, counts: null },
      scenarios: options.scenarios.map((scenario) => ({
        name: scenario,
        defaultRepetitions: SCENARIOS[scenario].defaultRepetitions,
        repetitions: options.repetitions ?? SCENARIOS[scenario].defaultRepetitions,
      })),
      captures: options.captures,
      source: fingerprint,
      machine: machineDescription(),
      ports: {
        frontend: runtime.frontendPort,
        adapter: runtime.adapterPort,
      },
      dataDirectory: runtime.dataDirectory,
      allowStaleBuild: options.allowStaleBuild,
    });

    exitCode = await runPlaywright(options, {
      ...process.env,
      TICKETRY_PERF_RUN_ID: runIdentifier,
      TICKETRY_PERF_RUN_DIR: directory,
      TICKETRY_PERF_ENGINE: options.engine,
      TICKETRY_PERF_DATASET: options.dataset,
      TICKETRY_PERF_CAPTURES: options.captures.join(","),
      TICKETRY_PERF_SCENARIOS: options.scenarios.join(","),
      TICKETRY_PERF_BASE_URL: runtime.baseURL,
      TICKETRY_PERF_HEADED: options.headed ? "1" : "0",
      ...(options.repetitions ? { TICKETRY_PERF_REPETITIONS: String(options.repetitions) } : {}),
    });

    const hostSamples = sampler.stop();
    const hostLoad = {
      intervalMs: 1_000,
      samples: hostSamples,
      noise: assessHostNoise(hostSamples),
    };
    const fixture = readJson(path.join(directory, RUN_FILES.fixture));
    if (fixture) {
      metadata.dataset = {
        size: fixture.size,
        version: fixture.datasetVersion,
        counts: fixture.counts,
      };
    }
    const { scenarios, cpuSummaries, manifest, engineVersion } = buildReport({
      metadata,
      options,
    });
    metadata.engineVersion = engineVersion;
    writeFileSync(
      path.join(directory, RUN_FILES.metadata),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    writeFileSync(
      path.join(directory, RUN_FILES.hostLoad),
      `${JSON.stringify(hostLoad, null, 2)}\n`,
    );
    writeFileSync(
      path.join(directory, RUN_FILES.summaryJson),
      `${JSON.stringify({ metadata, scenarios, cpuSummaries, hostLoad }, null, 2)}\n`,
    );
    writeFileSync(
      path.join(directory, RUN_FILES.summaryMarkdown),
      renderRunMarkdown({ metadata, scenarios, cpuSummaries, hostLoad }),
    );
    manifest.runFiles = Object.fromEntries(
      Object.entries(RUN_FILES)
        .map(([key, name]) => [key, path.join(directory, name)])
        .filter(([, file]) => existsSync(file)),
    );
    writeFileSync(
      path.join(directory, RUN_FILES.manifest),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    console.log(`[performance] artifacts written to ${directory}`);
    console.log(`[performance] report: ${path.join(directory, RUN_FILES.summaryMarkdown)}`);
  } finally {
    sampler.stop();
    await stop();
  }
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[performance] run failed: ${error.message}`);
    process.exitCode = 1;
  });
}
