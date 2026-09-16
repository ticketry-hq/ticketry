#!/usr/bin/env node
/**
 * Measure what the packaged Ticketry window's WKWebView content process holds.
 *
 * The existing packaged sampler (`native-view-resource-measurement.mjs`)
 * deliberately reports the GUI process alone, because a retained-view budget is
 * about AppKit views. That makes it silent on the process this investigation is
 * about: the `com.apple.WebKit.WebContent` XPC service rendering the frontend,
 * which launchd owns and which no parent link connects to the application.
 *
 * Commands:
 *   attribute --executable <app binary>
 *   capture   --executable <app binary> --scenario <name> --workload "<text>" ...
 *   report    -- <capture.json ...>
 *   compare   --baseline <a.json> --candidate <b.json> [--informational]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveWebContentProcess } from "../../performance/webcontent/attribution.mjs";
import { buildCapture, inspectContinuity } from "../../performance/webcontent/capture.mjs";
import { compareCaptures } from "../../performance/webcontent/compare.mjs";
import {
  buildIdentity,
  machineIdentity,
  readFootprint,
  readHostState,
  readProcessTable,
  readResources,
  recordStackSample,
} from "../../performance/webcontent/host.mjs";
import {
  renderCaptureMarkdown,
  renderComparisonMarkdown,
} from "../../performance/webcontent/markdown.mjs";
import { computeSourceFingerprint } from "./provenance.mjs";

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function flag(args, name) {
  return args.includes(name);
}

function required(args, name) {
  const value = option(args, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function attribute(args) {
  const executable = path.resolve(required(args, "--executable"));
  const windowSeconds = Number(option(args, "--window-seconds", "60"));
  const processTable = await readProcessTable();
  // Discovery is only needed when the caller did not name the window. Several
  // packaged instances routinely run at once on a development machine, so a
  // named pid always wins over a guess.
  const named = option(args, "--gui-pid");
  let guiPid;
  if (named !== undefined) {
    guiPid = Number(named);
  } else {
    const candidates = processTable.filter((row) => row.command === executable);
    if (candidates.length !== 1) {
      throw new Error(
        `expected exactly one running ${executable}, found ${candidates.length}`
        + (candidates.length > 1
          ? `: ${candidates.map(({ pid }) => pid).join(", ")}. Name one with --gui-pid.`
          : ""),
      );
    }
    guiPid = candidates[0].pid;
  }
  return {
    guiPid,
    ...resolveWebContentProcess({
      processTable,
      guiPid,
      expectedGuiCommand: executable,
      windowSeconds,
      assertedWebContentPid: option(args, "--webcontent-pid")
        ? Number(option(args, "--webcontent-pid"))
        : null,
    }),
  };
}

/** Source provenance is best-effort: a packaged artifact may outlive its tree. */
function sourceProvenance() {
  try {
    return computeSourceFingerprint();
  } catch (error) {
    return { value: null, reason: `source fingerprint unavailable: ${error.message}` };
  }
}

async function sampleOnce(guiPid, webContentPid, startedAtMs) {
  const [webContentFootprint, webContentResources, guiResources, host] = await Promise.all([
    readFootprint(webContentPid),
    readResources(webContentPid),
    readResources(guiPid),
    readHostState(),
  ]);
  return {
    offsetMs: Date.now() - startedAtMs,
    at: webContentFootprint.at ?? new Date().toISOString(),
    webContent: {
      pid: webContentPid,
      footprintBytes: webContentFootprint.footprintBytes,
      categories: webContentFootprint.categories,
      rssBytes: webContentResources.rssBytes,
      cpuPercent: webContentResources.cpuPercent,
      reason: webContentFootprint.reason ?? webContentResources.reason,
    },
    gui: guiResources,
    host,
  };
}

async function capture(args) {
  if (process.platform !== "darwin") throw new Error("this capture requires macOS");
  const executable = path.resolve(required(args, "--executable"));
  const output = path.resolve(required(args, "--output"));
  const scenario = {
    name: required(args, "--scenario"),
    workload: required(args, "--workload"),
    settleSeconds: Number(option(args, "--settle-seconds", "30")),
    seconds: Number(option(args, "--seconds", "120")),
    intervalMs: Number(option(args, "--interval-ms", "2000")),
    visibleViewerCount: Number(required(args, "--visible-viewers")),
    retainedViewerCount: Number(required(args, "--retained-viewers")),
    activeRunCount: Number(required(args, "--active-runs")),
    documentState: option(args, "--document-state", "no document open"),
    windowSize: option(args, "--window-size", null),
  };
  const attribution = await attribute(args);
  if (!attribution.pid) {
    throw new Error(`the WebContent process could not be attributed: ${attribution.reason}`);
  }

  process.stderr.write(
    `settling ${scenario.settleSeconds}s before sampling GUI ${attribution.guiPid} / `
    + `WebContent ${attribution.pid}\n`,
  );
  await sleep(scenario.settleSeconds * 1000);

  const samples = [];
  const discontinuities = [];
  const startedAtMs = Date.now();
  const deadline = startedAtMs + scenario.seconds * 1000;
  let stackFile = null;
  const stackAtMs = flag(args, "--stacks")
    ? startedAtMs + Math.floor(scenario.seconds * 1000 / 2)
    : null;

  while (Date.now() < deadline) {
    const table = await readProcessTable();
    const broken = inspectContinuity({
      guiPid: attribution.guiPid,
      webContentPid: attribution.pid,
      processTable: table,
    });
    if (broken) {
      discontinuities.push({ atOffsetMs: Date.now() - startedAtMs, ...broken });
      process.stderr.write(`capture ended early: ${broken.detail}\n`);
      break;
    }
    samples.push(await sampleOnce(attribution.guiPid, attribution.pid, startedAtMs));
    if (stackAtMs !== null && Date.now() >= stackAtMs && !stackFile) {
      stackFile = `${output.replace(/\.json$/, "")}.stacks.txt`;
      await recordStackSample(attribution.pid, { seconds: 10, outputPath: stackFile });
    }
    await sleep(scenario.intervalMs);
  }

  const record = buildCapture({
    scenario,
    build: { ...(await buildIdentity(executable)), source: sourceProvenance() },
    machine: await machineIdentity(),
    attribution: {
      guiPid: attribution.guiPid,
      webContentPid: attribution.pid,
      evidence: attribution.evidence,
      reason: attribution.reason,
    },
    instrumentation: {
      profiler: "footprint --json + ps, sampled from outside the process",
      diagnosticBuild: false,
      stackSample: stackFile,
      overheadNote:
        "sampling runs in a separate Node process; it does not execute inside "
        + "the measured WebContent process and adds no in-page instrumentation",
    },
    samples,
    discontinuities,
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${output}\n`);
}

async function report(args) {
  const separator = args.indexOf("--");
  const files = separator === -1 ? args : args.slice(separator + 1);
  if (files.length === 0) throw new Error("report needs at least one capture path");
  for (const file of files) {
    const record = JSON.parse(await readFile(file, "utf8"));
    process.stdout.write(renderCaptureMarkdown(record));
    process.stdout.write("\n");
  }
}

async function compare(args) {
  const [baseline, candidate] = await Promise.all([
    readFile(required(args, "--baseline"), "utf8").then(JSON.parse),
    readFile(required(args, "--candidate"), "utf8").then(JSON.parse),
  ]);
  const comparison = compareCaptures(baseline, candidate, {
    informational: flag(args, "--informational"),
  });
  process.stdout.write(renderComparisonMarkdown(comparison));
}

const COMMANDS = {
  attribute: async (args) => process.stdout.write(`${JSON.stringify(await attribute(args), null, 2)}\n`),
  capture,
  report,
  compare,
};

async function main([command, ...rest]) {
  const run = COMMANDS[command];
  if (!run) throw new Error(`usage: webcontent-memory.mjs <${Object.keys(COMMANDS).join("|")}> ...`);
  return run(rest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
