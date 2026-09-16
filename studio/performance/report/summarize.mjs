/**
 * Turning raw observations into the numbers a report may state.
 *
 * Two rules run through this module. Missing data stays missing — an absent
 * sample never becomes a zero. And every quantile carries its convention and
 * its sample count, because a p95 over twenty samples is one observation away
 * from a different answer and must not be presented as precision.
 */
import { unavailable } from "./schema.mjs";

/** Nearest-rank on ascending samples: index = ceil(p * n) - 1. */
export const QUANTILE_CONVENTION = "nearest-rank (index = ceil(p * n) - 1, ascending)";

/** Below this many samples a p95 is labelled approximate in every report. */
export const APPROXIMATE_QUANTILE_SAMPLE_LIMIT = 40;

export function quantile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Summarize a list of timings. An empty list is reported as unavailable with a
 * reason, never as `{median: 0}`.
 */
export function summarizeTimings(values, { unit = "ms" } = {}) {
  const finite = (values ?? []).filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return {
      ...unavailable("no samples were recorded"),
      count: 0,
      unit,
    };
  }
  const total = finite.reduce((sum, value) => sum + value, 0);
  return {
    value: null,
    reason: null,
    unit,
    count: finite.length,
    min: Math.min(...finite),
    median: quantile(finite, 0.5),
    p95: quantile(finite, 0.95),
    max: Math.max(...finite),
    mean: total / finite.length,
    quantileConvention: QUANTILE_CONVENTION,
    quantilesApproximate: finite.length < APPROXIMATE_QUANTILE_SAMPLE_LIMIT,
    samples: finite,
  };
}

/**
 * Top functions of a V8 CPU profile by *self* time.
 *
 * `timeDeltas[i]` is the interval that ended at `samples[i]`, so the whole
 * delta is charged to the node the sample landed on. Callers are never charged
 * — that would be inclusive time wearing a self-time label.
 */
export function summarizeCpuProfile(profile, { limit = 25 } = {}) {
  if (!profile || !Array.isArray(profile.nodes)) {
    return unavailable("the CPU profile has no node table");
  }
  const { samples = [], timeDeltas = [], nodes, startTime, endTime } = profile;
  if (samples.length === 0) {
    return unavailable("the CPU profile recorded no samples");
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selfTimeUs = new Map();
  let attributedUs = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const delta = timeDeltas[index];
    if (!Number.isFinite(delta) || delta < 0) continue;
    const nodeId = samples[index];
    selfTimeUs.set(nodeId, (selfTimeUs.get(nodeId) ?? 0) + delta);
    attributedUs += delta;
  }
  const allFrames = [...selfTimeUs.entries()]
    .map(([nodeId, microseconds]) => describeFrame(byId.get(nodeId), nodeId, microseconds, attributedUs))
    .sort((left, right) => right.selfTimeUs - left.selfTimeUs);
  return {
    value: null,
    reason: null,
    sampleCount: samples.length,
    attributedUs,
    recordedDurationUs: Number.isFinite(startTime) && Number.isFinite(endTime)
      ? endTime - startTime
      : null,
    timeBasis: "self time from samples and timeDeltas; inclusive time is not reported",
    frames: allFrames.slice(0, limit),
    // A headless profile is shared with the automation driver: Playwright's
    // injected script resolves selectors inside the same renderer. Splitting
    // the attributed time by script origin says how much of the profile is the
    // application at all, before any frame is read as a bottleneck.
    origins: summarizeFrameOrigins(allFrames, attributedUs),
    applicationFrames: allFrames.filter((frame) => !frame.unresolved).slice(0, limit),
    attributionNote:
      "Engine, garbage-collector and driver-injected frames carry no script URL "
      + "and stay unresolved. Only the application frames below can be traced "
      + "back to Ticketry source through the build's source maps.",
  };
}

/** Attributed self time per script origin, with unresolved frames kept separate. */
function summarizeFrameOrigins(frames, attributedUs) {
  const totals = new Map();
  for (const frame of frames) {
    let key = "(unresolved)";
    if (frame.url) {
      try {
        key = new URL(frame.url).origin;
      } catch {
        key = frame.url;
      }
    }
    totals.set(key, (totals.get(key) ?? 0) + frame.selfTimeUs);
  }
  return [...totals.entries()]
    .map(([origin, microseconds]) => ({
      origin,
      selfTimeUs: microseconds,
      selfPercent: attributedUs > 0 ? (microseconds / attributedUs) * 100 : null,
    }))
    .sort((left, right) => right.selfTimeUs - left.selfTimeUs);
}

function describeFrame(node, nodeId, selfTimeUs, attributedUs) {
  const callFrame = node?.callFrame;
  const url = callFrame?.url ?? "";
  return {
    nodeId,
    functionName: callFrame?.functionName || "(anonymous)",
    url: url || null,
    // A frame with no script URL is a native, garbage-collector or engine
    // frame. It is labelled, never guessed at and never dropped.
    unresolved: !url,
    lineNumber: callFrame?.lineNumber ?? null,
    columnNumber: callFrame?.columnNumber ?? null,
    selfTimeUs,
    selfPercent: attributedUs > 0 ? (selfTimeUs / attributedUs) * 100 : null,
    hitCount: node?.hitCount ?? null,
  };
}

/**
 * Batch-over-batch heap and DOM movement. Growth is reported as a lead, and
 * the first batch is named as warmup rather than folded into the trend.
 */
export function summarizeRetention(batches) {
  if (!Array.isArray(batches) || batches.length < 2) {
    return unavailable("retention needs at least two settled batches");
  }
  const series = (pick) => batches.map(pick);
  const growth = (values) => {
    const usable = values.filter((value) => Number.isFinite(value));
    if (usable.length < 2) return null;
    return usable[usable.length - 1] - usable[0];
  };
  const afterWarmup = batches.slice(1);
  const monotonic = (values) => {
    const usable = values.filter((value) => Number.isFinite(value));
    return usable.length >= 2 && usable.every((value, index) =>
      index === 0 || value >= usable[index - 1]
    );
  };
  const heapSeries = series((batch) => batch.usedJsHeapBytes ?? null);
  const domSeries = series((batch) => batch.domNodeCount ?? null);
  return {
    value: null,
    reason: null,
    batchCount: batches.length,
    warmupBatches: 1,
    usedJsHeapBytes: heapSeries,
    domNodeCount: domSeries,
    heapGrowthBytes: growth(heapSeries),
    heapGrowthBytesAfterWarmup: growth(afterWarmup.map((batch) => batch.usedJsHeapBytes ?? null)),
    domGrowth: growth(domSeries),
    domGrowthAfterWarmup: growth(afterWarmup.map((batch) => batch.domNodeCount ?? null)),
    heapGrowsEveryBatchAfterWarmup: monotonic(
      afterWarmup.map((batch) => batch.usedJsHeapBytes ?? null),
    ),
    interpretation:
      "batch-over-batch growth is a lead, not a leak. Cache warmup also grows "
      + "the heap; only continued growth across settled batches after warmup "
      + "distinguishes the two, and JS heap bytes and OS physical footprint "
      + "remain separate measurements.",
  };
}

/** GraphQL operation counts split into setup and measured windows. */
export function summarizeOperations(windows) {
  const summary = {};
  for (const [name, operations] of Object.entries(windows ?? {})) {
    const total = Object.values(operations ?? {}).reduce(
      (sum, entry) => sum + (entry.count ?? 0),
      0,
    );
    summary[name] = { totalOperations: total, operations: operations ?? {} };
  }
  return summary;
}

/** One scenario's observations become one report section. */
export function summarizeScenario(observations) {
  const timings = {};
  for (const [name, values] of Object.entries(observations.timings ?? {})) {
    timings[name] = summarizeTimings(values);
  }
  return {
    scenario: observations.scenario,
    engine: observations.engine,
    engineName: observations.engineName ?? null,
    engineVersion: observations.engineVersion ?? null,
    status: observations.status ?? "unknown",
    repetitions: observations.repetitions
      ?? observations.parameters?.repetitions
      ?? observations.parameters?.batches
      ?? null,
    warmups: observations.warmups ?? observations.parameters?.warmups ?? null,
    parameters: observations.parameters ?? {},
    timings,
    probes: observations.probes ?? null,
    operations: summarizeOperations(observations.operationWindows),
    pageErrors: observations.pageErrors ?? null,
    retention: observations.batches
      ? summarizeRetention(observations.batches)
      : unavailable("this scenario records no retention batches"),
    failures: observations.failures ?? [],
  };
}
