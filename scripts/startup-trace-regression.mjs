// Compares the latest desktop and frontend startup against this machine's
// recent history and shouts when startup got slower. History is the
// development log itself, so every `desktop:dev` launch is a measurement.
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { latestStartupTrace, parseStartupTraceRecords } from "./startup-trace-report.mjs";

export const REGRESSION_FACTOR = 1.25;
const HISTORY_DEPTH = 10;
const FINAL_STAGE = { desktop: "recovery-runtimes-ready", frontend: "frontend-workspace-restored" };

export function groupStartupTraces(records) {
  const byId = new Map();
  for (const record of records) {
    if (!byId.has(record.startup_id)) byId.set(record.startup_id, []);
    byId.get(record.startup_id).push(record);
  }
  return [...byId.entries()].map(([id, trace]) => {
    const kind = trace.some((record) => record.source === "frontend") ? "frontend" : "desktop";
    const complete = trace.some((record) => record.stage === FINAL_STAGE[kind]);
    return { id, kind, records: trace, complete, totalMs: Math.max(...trace.map((record) => record.elapsed_ms)) };
  });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function slowestGrowingStage(latest, history) {
  const baseline = (stage) => {
    const durations = history.flatMap((trace) => trace.records.filter((r) => r.stage === stage).map((r) => r.duration_ms));
    return durations.length ? median(durations) : null;
  };
  return latest.records
    .map((record) => ({ stage: record.stage, durationMs: record.duration_ms, baselineMs: baseline(record.stage) }))
    .filter((entry) => entry.baselineMs !== null)
    .sort((a, b) => (b.durationMs - b.baselineMs) - (a.durationMs - a.baselineMs))[0] ?? null;
}

export function compareStartupTraces(records, { factor = REGRESSION_FACTOR } = {}) {
  const traces = groupStartupTraces(records);
  return ["desktop", "frontend"].flatMap((kind) => {
    const ofKind = traces.filter((trace) => trace.kind === kind);
    const latest = ofKind.at(-1);
    if (!latest) return [];
    const history = ofKind.slice(0, -1).filter((trace) => trace.complete).slice(-HISTORY_DEPTH);
    const baselineMs = history.length ? median(history.map((trace) => trace.totalMs)) : null;
    return [{
      kind,
      complete: latest.complete,
      latestMs: latest.totalMs,
      baselineMs,
      samples: history.length,
      regressed: latest.complete && baselineMs !== null && latest.totalMs > baselineMs * factor,
      culprit: history.length ? slowestGrowingStage(latest, history) : null,
    }];
  });
}

export function renderStartupRegressionReport(comparisons) {
  const lines = comparisons.map((c) => {
    const baseline = c.baselineMs === null ? "no history yet" : `median of last ${c.samples}: ${c.baselineMs} ms`;
    const status = !c.complete ? "INCOMPLETE" : c.regressed ? "REGRESSED" : "ok";
    return `${c.kind.padEnd(8)} startup ${String(c.latestMs).padStart(6)} ms  (${baseline})  ${status}`;
  });
  const regressed = comparisons.filter((c) => c.regressed);
  if (regressed.length === 0) return lines.join("\n");
  const culprits = regressed
    .filter((c) => c.culprit)
    .map((c) => `  ${c.kind}: ${c.culprit.stage} took ${c.culprit.durationMs} ms, usually ${c.culprit.baselineMs} ms`);
  const bar = "!".repeat(72);
  return [bar, "STARTUP TIME REGRESSION", ...lines, ...culprits, bar].join("\n");
}

/** Wait for the launch started by `startupId` to finish booting, then report. */
export async function awaitStartupRegressionReport({
  logPath,
  startupId,
  timeoutMs = 180_000,
  pollMs = 500,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(pollMs);
    if (!existsSync(logPath)) continue;
    const records = parseStartupTraceRecords(readFileSync(logPath, "utf8").split(/\r?\n/));
    const ours = records.findIndex((record) => record.startup_id === startupId && record.stage === "launcher-started");
    if (ours === -1) continue;
    const since = records.slice(ours);
    const desktopDone = since.some((record) => record.stage === FINAL_STAGE.desktop);
    const frontendDone = since.some((record) => record.stage === FINAL_STAGE.frontend);
    if (desktopDone && frontendDone) {
      // Only the traces up to and including this launch count, in case another one started.
      return renderStartupRegressionReport(compareStartupTraces(records));
    }
  }
  return `Startup trace for ${startupId} did not complete within ${timeoutMs / 1000}s; see npm run logs:startup`;
}
