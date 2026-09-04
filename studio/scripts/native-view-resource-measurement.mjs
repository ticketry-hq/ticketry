#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const requiredViewCounts = [1, 5, 20];
export const RETENTION_BUDGET_POLICY = Object.freeze({
  incrementalCpuPercent: 1,
  incrementalMemoryPercent: 1,
});

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function summarizeSamples(samples) {
  if (samples.length === 0) throw new Error("measurement has no process samples");
  const cpu = samples.map(({ cpuPercent }) => cpuPercent);
  const rss = samples.map(({ rssBytes }) => rssBytes);
  return {
    cpuMedianPercent: round(percentile(cpu, 0.5)),
    cpuP95Percent: round(percentile(cpu, 0.95)),
    cpuMaxPercent: round(Math.max(...cpu)),
    rssMedianBytes: percentile(rss, 0.5),
    rssP95Bytes: percentile(rss, 0.95),
    rssMinBytes: Math.min(...rss),
    rssMaxBytes: Math.max(...rss),
  };
}

export function parseProcessTable(output, rootPid) {
  const rows = output.trim().split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      cpuPercent: Number(match[3]),
      rssBytes: Number(match[4]) * 1024,
      command: match[5],
    }];
  });
  const packagedProcess = rows.find(({ pid }) => pid === rootPid);
  if (!packagedProcess) {
    throw new Error(`packaged process ${rootPid} is not running`);
  }
  return {
    cpuPercent: packagedProcess.cpuPercent,
    rssBytes: packagedProcess.rssBytes,
    processes: [{
      pid: packagedProcess.pid,
      parentPid: packagedProcess.parentPid,
      command: packagedProcess.command,
    }],
  };
}

function assertFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
}

export function validateCapture(capture) {
  if (capture?.schemaVersion !== 1) throw new Error("capture schemaVersion must be 1");
  if (!requiredViewCounts.includes(capture.scenario?.viewCount)) {
    throw new Error("scenario viewCount must be 1, 5, or 20");
  }
  if (!Number.isInteger(capture.scenario?.visibleCount)
    || capture.scenario.visibleCount < 0
    || capture.scenario.visibleCount > capture.scenario.viewCount) {
    throw new Error("scenario visibleCount must fit within viewCount");
  }
  if (![0, 1].includes(capture.scenario?.selectedCount)) {
    throw new Error("scenario selectedCount must be 0 or 1");
  }
  if (capture.scenario.selectedCount > capture.scenario.visibleCount) {
    throw new Error("a selected view must be visible");
  }
  if (!capture.scenario?.workload?.trim()) throw new Error("scenario workload is required");
  if (capture.scenario?.seconds < 60) throw new Error("scenario seconds must be at least 60");
  if (capture.scenario?.intervalMs < 250 || capture.scenario?.intervalMs > 1000) {
    throw new Error("scenario intervalMs must be between 250 and 1000");
  }
  if (!capture.build?.executableSha256) throw new Error("build executableSha256 is required");
  if (!capture.machine?.model || !capture.machine?.macOS || !capture.machine?.architecture) {
    throw new Error("machine identity is required");
  }
  assertFinitePositive(capture.machine.totalMemoryBytes, "machine totalMemoryBytes");
  assertFinitePositive(capture.process?.sampleCount, "process sampleCount");
  const expectedSamples = capture.scenario.seconds * 1000 / capture.scenario.intervalMs;
  if (capture.process.sampleCount < expectedSamples * 0.9) {
    throw new Error("capture has fewer than 90% of its expected process samples");
  }
  if (!capture.summary) throw new Error("capture summary is required");
  return capture;
}

function sameScenario(left, right) {
  return left.scenario.visibleCount === right.scenario.visibleCount
    && left.scenario.selectedCount === right.scenario.selectedCount
    && left.scenario.workload === right.scenario.workload
    && left.scenario.seconds === right.scenario.seconds
    && left.scenario.intervalMs === right.scenario.intervalMs;
}

export function analyzeCaptureSet(captures, budgetPolicy = RETENTION_BUDGET_POLICY) {
  for (const capture of captures) validateCapture(capture);
  const counts = new Set(captures.map(({ scenario }) => scenario.viewCount));
  const missing = requiredViewCounts.filter((count) => !counts.has(count));
  if (missing.length > 0) throw new Error(`missing packaged captures for ${missing.join(", ")} native views`);
  const reference = captures[0];
  for (const capture of captures.slice(1)) {
    if (capture.build.executableSha256 !== reference.build.executableSha256) {
      throw new Error("captures use different packaged executables");
    }
    if (capture.machine.model !== reference.machine.model
      || capture.machine.macOS !== reference.machine.macOS
      || capture.machine.architecture !== reference.machine.architecture) {
      throw new Error("captures use different machines or macOS versions");
    }
    if (!sameScenario(capture, reference)) {
      throw new Error("captures use different visibility, selection, or workload conditions");
    }
  }
  assertFinitePositive(budgetPolicy.incrementalCpuPercent, "incremental CPU budget");
  assertFinitePositive(budgetPolicy.incrementalMemoryPercent, "incremental memory budget");
  const budgets = {
    ...budgetPolicy,
    incrementalRssMiB: round(
      reference.machine.totalMemoryBytes
        * budgetPolicy.incrementalMemoryPercent / 100 / 1024 / 1024,
    ),
  };

  const rows = requiredViewCounts.map((viewCount) => {
    const matching = captures.filter((capture) => capture.scenario.viewCount === viewCount);
    return {
      viewCount,
      captures: matching.length,
      cpuP95Percent: round(Math.max(...matching.map(({ summary }) => summary.cpuP95Percent))),
      rssP95MiB: round(Math.max(...matching.map(({ summary }) => summary.rssP95Bytes)) / 1024 / 1024),
    };
  });
  const one = rows[0];
  for (const row of rows) {
    row.incrementalCpuPercent = round(row.cpuP95Percent - one.cpuP95Percent);
    row.incrementalRssMiB = round(row.rssP95MiB - one.rssP95MiB);
    row.incrementalRssPerViewMiB = row.viewCount === 1
      ? 0
      : round(row.incrementalRssMiB / (row.viewCount - 1));
    row.withinBudget = row.incrementalRssMiB <= budgets.incrementalRssMiB
      && row.incrementalCpuPercent <= budgets.incrementalCpuPercent;
  }
  const eligible = rows.filter(({ withinBudget }) => withinBudget);
  if (eligible.length === 0) {
    throw new Error("even the one-view capture exceeds the declared CPU or RSS budget");
  }
  return {
    budgets,
    rows,
    retentionLimit: eligible.at(-1).viewCount,
    build: reference.build,
    machine: reference.machine,
    scenario: {
      visibleCount: reference.scenario.visibleCount,
      selectedCount: reference.scenario.selectedCount,
      workload: reference.scenario.workload,
    },
  };
}

export function renderReport(analysis) {
  const lines = [
    "# Native Ghostty retained-view measurement",
    "",
    `Packaged executable SHA-256: \`${analysis.build.executableSha256}\``,
    `Machine: ${analysis.machine.model}; macOS ${analysis.machine.macOS}`,
    `Workload: ${analysis.scenario.workload}`,
    `Declared budgets above the one-view baseline: RSS p95 <= ${analysis.budgets.incrementalRssMiB} MiB (${analysis.budgets.incrementalMemoryPercent}% of physical RAM); CPU p95 <= ${analysis.budgets.incrementalCpuPercent} percentage point`,
    "",
    "| Views | Captures | CPU p95 | CPU over baseline | RSS p95 | Incremental RSS | Incremental RSS/view | Within budget |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |",
  ];
  for (const row of analysis.rows) {
    lines.push(`| ${row.viewCount} | ${row.captures} | ${row.cpuP95Percent}% | ${row.incrementalCpuPercent} pp | ${row.rssP95MiB} MiB | ${row.incrementalRssMiB} MiB | ${row.incrementalRssPerViewMiB} MiB | ${row.withinBudget ? "yes" : "no"} |`);
  }
  lines.push(
    "",
    `Measured warm retention limit: **${analysis.retentionLimit} native views**.`,
    "",
    "The limit is the largest measured candidate that stays within both budgets. The report never extrapolates an unmeasured count.",
  );
  return `${lines.join("\n")}\n`;
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function requiredOption(args, name) {
  const value = option(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function executableIdentity(executable) {
  const bytes = await readFile(executable);
  return createHash("sha256").update(bytes).digest("hex");
}

async function machineIdentity() {
  const [{ stdout: macOS }, { stdout: model }] = await Promise.all([
    execFile("sw_vers", ["-productVersion"]),
    execFile("sysctl", ["-n", "hw.model"]),
  ]);
  return {
    model: model.trim(),
    macOS: macOS.trim(),
    architecture: os.arch(),
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
}

async function samplePackagedProcess(pid) {
  const { stdout } = await execFile("ps", ["-axo", "pid=,ppid=,%cpu=,rss=,comm="]);
  return parseProcessTable(stdout, pid);
}

async function verifyPackagedProcess(pid, executable) {
  if (!executable.includes(".app/Contents/MacOS/")) {
    throw new Error("--executable must point inside a packaged macOS .app");
  }
  const [{ stdout }, expected] = await Promise.all([
    execFile("ps", ["-p", String(pid), "-o", "comm="]),
    realpath(executable),
  ]);
  const running = stdout.trim();
  if (!running) throw new Error(`packaged process ${pid} is not running`);
  let actual;
  try {
    actual = await realpath(running);
  } catch {
    actual = running;
  }
  if (actual !== expected) {
    throw new Error(`PID ${pid} runs ${running}, not ${executable}`);
  }
}

async function captureCommand(args) {
  if (process.platform !== "darwin") throw new Error("packaged native-view measurement requires macOS");
  const pid = Number(requiredOption(args, "--pid"));
  const executable = path.resolve(requiredOption(args, "--executable"));
  const output = path.resolve(requiredOption(args, "--output"));
  const seconds = Number(option(args, "--seconds", "60"));
  const intervalMs = Number(option(args, "--interval-ms", "1000"));
  const viewCount = Number(requiredOption(args, "--views"));
  const visibleCount = Number(option(args, "--visible", "1"));
  const selectedCount = Number(option(args, "--selected", "1"));
  const workload = requiredOption(args, "--workload");
  assertFinitePositive(pid, "PID");
  assertFinitePositive(seconds, "seconds");
  assertFinitePositive(intervalMs, "interval-ms");
  await verifyPackagedProcess(pid, executable);
  const samples = [];
  const startedAt = new Date();
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const observed = await samplePackagedProcess(pid);
    samples.push({
      offsetMs: Date.now() - startedAt.getTime(),
      cpuPercent: round(observed.cpuPercent),
      rssBytes: observed.rssBytes,
      processCount: observed.processes.length,
    });
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const capture = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    scenario: { viewCount, visibleCount, selectedCount, seconds, intervalMs, workload },
    process: { pid, sampleCount: samples.length },
    build: {
      executable,
      executableSha256: await executableIdentity(executable),
    },
    machine: await machineIdentity(),
    samples,
    summary: summarizeSamples(samples),
  };
  validateCapture(capture);
  await writeFile(output, `${JSON.stringify(capture, null, 2)}\n`);
  process.stdout.write(`${output}\n`);
}

async function reportCommand(args) {
  const separator = args.indexOf("--");
  const files = separator === -1 ? args : args.slice(separator + 1);
  if (files.length === 0) throw new Error("report needs capture paths");
  const captures = await Promise.all(files.map((file) => readFile(file, "utf8").then(JSON.parse)));
  const analysis = analyzeCaptureSet(captures);
  process.stdout.write(renderReport(analysis));
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === "capture") return captureCommand(rest);
  if (command === "report") return reportCommand(rest);
  throw new Error("usage: native-view-resource-measurement.mjs <capture|report> ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
