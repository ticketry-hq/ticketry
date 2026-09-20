import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTemporarySqliteProfile,
  removeTemporarySqliteProfile,
  resolveDevelopmentTmuxSocket,
  stopTemporaryTmuxServer,
} from "../desktop-dev.mjs";
import { prepareDesktopHookRunner } from "../desktop-hook-runner.mjs";
import {
  availablePort,
  connectToStudio,
  defaultDesktopBinary,
  spawnTicketry,
  stopProcess,
} from "../desktop-webdriver-session.mjs";
import { renderDesktopMarkdown } from "../../performance/report/markdown.mjs";
import { RUN_FILES } from "../../performance/report/schema.mjs";
import { summarizeScenario } from "../../performance/report/summarize.mjs";
import { desktopUsage, parsePerformanceDesktopOptions } from "./options.mjs";
import { sampleHostLoad } from "./host-load.mjs";
import {
  newRunIdentifier,
  performanceBuildDirectory,
  runDirectory,
  scenarioDirectory,
  studioRoot,
} from "./paths.mjs";
import {
  createProcessSampler,
  listWebviewPids,
  resolveWebviewProcess,
} from "./process-metrics.mjs";
import { computeSourceFingerprint } from "./provenance.mjs";
import { startProfilingAdapter } from "./server.mjs";
import { desktopProbeSource, DESKTOP_SCENARIO_SCRIPTS } from "./desktop-scenarios.mjs";
import { prepareChangesFixture, removeChangesFixture } from "./changes-fixture.mjs";

/**
 * Desktop confirmation on the real macOS WKWebView.
 *
 * The browser suite measures Chromium and Playwright's WebKit; neither is the
 * WebView Ticketry actually ships in. This command drives the same idle,
 * picker and navigation actions through the existing test-only embedded
 * WebDriver, on an isolated temporary profile and private tmux server.
 *
 * What it does not claim matters as much as what it measures. There is no
 * supported JavaScript CPU or heap recording interface for this WebView here,
 * so the run reports UI delay, the renderer's own counters and whatever
 * process metrics the OS will attribute — and points at Web Inspector's
 * Timelines tab for the rest. A Chromium profile never identifies the hot
 * function inside WebKit.
 *
 * It never installs over /Applications/Ticketry.app, never enables production
 * WebDriver and never opens the live data directory.
 */
const SETTLE_MS = 3_000;

function run(command, arguments_, { cwd = studioRoot, label }) {
  const startedAt = Date.now();
  const result = spawnSync(command, arguments_, { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
  return Date.now() - startedAt;
}

/**
 * Build the test-only desktop artifact against the already-prepared,
 * source-mapped frontend. `beforeBuildCommand` is cleared so this never
 * rebuilds and overwrites `studio/dist`, which another workflow may own.
 */
export function buildDesktopArtifact() {
  if (!existsSync(path.join(performanceBuildDirectory, "index.html"))) {
    throw new Error(
      "the profiling frontend bundle is missing. Run "
      + "npm run perf:prepare --workspace @worktracker/studio first.",
    );
  }
  prepareDesktopHookRunner({ root: path.resolve(studioRoot, "..") });
  return run("npm", [
    "exec",
    "tauri",
    "build",
    "--",
    "--debug",
    "--no-bundle",
    "--features",
    "desktop-acceptance",
    "--config",
    JSON.stringify({
      build: { beforeBuildCommand: "", frontendDist: "../dist-performance" },
    }),
  ], { label: "tauri build (desktop-acceptance)" });
}

function seedThroughAdapter({ adapterOrigin, directory, dataset }) {
  const child = spawnSync("npm", [
    "exec",
    "--",
    "playwright",
    "test",
    "--config",
    "playwright.performance.config.ts",
    "--project",
    "seed",
  ], {
    cwd: studioRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      TICKETRY_PERF_RUN_ID: path.basename(directory),
      TICKETRY_PERF_RUN_DIR: directory,
      TICKETRY_PERF_ENGINE: "webkit-desktop",
      TICKETRY_PERF_DATASET: dataset,
      TICKETRY_PERF_CAPTURES: "",
      TICKETRY_PERF_SCENARIOS: "idle",
      // The seed talks to the adapter directly; no preview proxy is involved.
      TICKETRY_PERF_BASE_URL: adapterOrigin,
    },
  });
  if (child.status !== 0) {
    throw new Error(`seeding the desktop profile failed with exit code ${child.status}`);
  }
}

async function installProbes(browser) {
  // Reinstalled after every navigation: a reload drops the page's globals, and
  // a scenario that measured a page without probes would report nothing at all
  // rather than reporting that it could not measure.
  await browser.execute(desktopProbeSource());
}

export async function main(argv = process.argv.slice(2)) {
  if (process.platform !== "darwin") {
    throw new Error(
      `desktop confirmation drives the macOS WKWebView and cannot run on ${process.platform}`,
    );
  }
  const options = parsePerformanceDesktopOptions(argv);
  const runIdentifier = options.runIdentifier ?? newRunIdentifier();
  const directory = runDirectory(runIdentifier);
  mkdirSync(directory, { recursive: true });

  const buildMs = options.skipBuild ? null : buildDesktopArtifact();
  const dataDirectory = createTemporarySqliteProfile();
  const tmuxSocket = resolveDevelopmentTmuxSocket(dataDirectory);
  const applicationDirectory = path.join(dataDirectory, "app");
  mkdirSync(applicationDirectory, { recursive: true });

  let adapter = null;
  let desktop = null;
  let browser = null;
  let sampler = null;
  let changesFixture = null;
  const cleanup = async () => {
    if (browser) await browser.deleteSession().catch(() => {});
    await stopProcess(desktop);
    await adapter?.stop();
    sampler?.stop();
    stopTemporaryTmuxServer(tmuxSocket);
    removeChangesFixture(changesFixture);
    try {
      removeTemporarySqliteProfile(dataDirectory);
    } catch (error) {
      console.warn(`[performance] temporary profile not removed: ${error.message}`);
    }
  };
  const handleSignal = (signal) => {
    void cleanup().finally(() => process.kill(process.pid, signal));
  };
  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  const scenarios = [];
  try {
    // Seed over HTTP first: the desktop shell speaks Tauri IPC, so the same
    // generated operations reach this profile through the adapter, and the
    // application then opens the database the seed left behind.
    adapter = await startProfilingAdapter({ dataDirectory, tmuxSocket });
    seedThroughAdapter({
      adapterOrigin: adapter.origin,
      directory,
      dataset: "small",
    });
    const fixture = JSON.parse(
      readFileSync(path.join(directory, RUN_FILES.fixture), "utf8"),
    );
    await adapter.stop();
    adapter = null;
    if (options.scenarios.includes("changes-loading")) {
      changesFixture = prepareChangesFixture({ fixture, dataDirectory });
      fixture.changes = changesFixture;
      writeFileSync(
        path.join(directory, RUN_FILES.fixture),
        `${JSON.stringify(fixture, null, 2)}\n`,
      );
    }

    const binary = path.join(applicationDirectory, "ticketry");
    copyFileSync(defaultDesktopBinary(), binary);
    chmodSync(binary, 0o755);
    const hook = path.join(
      studioRoot,
      "src-tauri",
      "target",
      "debug",
      "ticketry-hook",
    );
    if (existsSync(hook)) {
      copyFileSync(hook, path.join(applicationDirectory, "ticketry-hook"));
      chmodSync(path.join(applicationDirectory, "ticketry-hook"), 0o755);
    }

    const webviewsBefore = listWebviewPids();
    const webdriverPort = await availablePort();
    const stdout = [];
    const stderr = [];
    desktop = spawnTicketry(binary, {
      MUXED_DATA_DIR: dataDirectory,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: tmuxSocket,
      TAURI_WEBDRIVER_PORT: String(webdriverPort),
    }, stdout, stderr);
    browser = await connectToStudio(webdriverPort, desktop);

    const webview = resolveWebviewProcess({ existingPids: webviewsBefore });
    sampler = createProcessSampler({
      intervalMs: 1_000,
      targets: { app: desktop.pid, webview: webview.pid },
    });
    sampler.start();

    for (const scenario of options.scenarios) {
      const script = DESKTOP_SCENARIO_SCRIPTS[scenario];
      await installProbes(browser);
      const observations = await script({
        browser,
        fixture,
        settleMs: SETTLE_MS,
        installProbes: () => installProbes(browser),
      });
      const scenarioPath = scenarioDirectory(runIdentifier, "webkit-desktop", scenario);
      mkdirSync(scenarioPath, { recursive: true });
      const payload = {
        scenario,
        engine: "webkit-desktop",
        engineName: "macOS WKWebView",
        engineVersion: await browser.execute(() => navigator.userAgent),
        ...observations,
      };
      writeFileSync(
        path.join(scenarioPath, "observations.json"),
        `${JSON.stringify(payload, null, 2)}\n`,
      );
      scenarios.push(summarizeScenario(payload));
    }

    const processSamples = sampler.stop();
    sampler = null;
    const metadata = {
      schemaVersion: 1,
      runIdentifier,
      startedAt: new Date().toISOString(),
      engine: "webkit-desktop",
      surface: "macOS WKWebView through the test-only embedded WebDriver",
      buildMode: "tauri --debug --features desktop-acceptance over dist-performance",
      buildMs,
      dataDirectory,
      tmuxSocket,
      dataset: {
        size: fixture.size,
        version: fixture.datasetVersion,
        counts: fixture.counts,
      },
      machine: {
        platform: process.platform,
        architecture: process.arch,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
      },
      hostLoad: sampleHostLoad(),
      source: computeSourceFingerprint(),
      processMetrics: {
        app: { pid: desktop.pid },
        webview,
        samples: processSamples,
        note: "ps-derived resident size and CPU percentage. A WKWebView content "
          + "process is owned by launchd, so it is only attributed when exactly "
          + "one new one appeared; otherwise it is reported unavailable.",
      },
      javascriptProfiling: {
        value: null,
        reason: "no supported JavaScript CPU or heap recording interface is "
          + "available for this WebView from the harness. Record the same "
          + "scenario by hand in Safari's Web Inspector (Develop > the Ticketry "
          + "process > Timelines > JavaScript & Events, record, replay the "
          + "scenario, then export the recording). A Chromium CPU profile does "
          + "not identify the hot function inside WebKit and must not be cited "
          + "as if it did.",
      },
    };
    writeFileSync(
      path.join(directory, RUN_FILES.metadata),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    writeFileSync(
      path.join(directory, RUN_FILES.summaryJson),
      `${JSON.stringify({ metadata, scenarios }, null, 2)}\n`,
    );
    writeFileSync(
      path.join(directory, RUN_FILES.summaryMarkdown),
      renderDesktopMarkdown({ metadata, scenarios }),
    );
    console.log(`[performance] desktop artifacts written to ${directory}`);
  } finally {
    await cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[performance] desktop confirmation failed: ${error.message}`);
    console.error(desktopUsage());
    process.exitCode = 1;
  });
}
