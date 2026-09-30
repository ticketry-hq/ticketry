/**
 * Comparing two WebContent memory captures.
 *
 * The interesting work is refusal. Two captures may only be subtracted when
 * they measured the same artifact, on the same machine class, with the same
 * sampling parameters and the same instrumentation; anything else makes the
 * delta a property of the harness rather than of the workload, and this module
 * says so instead of printing a number. `--informational` acknowledges the
 * mismatch rather than hiding it.
 *
 * What a compatible comparison then reports is a difference in conditions —
 * viewer counts, retained viewers, active runs, document state — never a
 * verdict. No pass or fail threshold exists here.
 */
import { captureComparisonKey, validateCapture } from "./schema.mjs";

/** Workload dimensions a comparison exists to vary, so it must print them. */
const CONDITION_FIELDS = Object.freeze([
  "visibleViewerCount",
  "retainedViewerCount",
  "activeRunCount",
  "documentState",
]);

function describe(value) {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
}

function assertReadable(capture, label) {
  const problems = validateCapture(capture);
  if (problems.length === 0) return;
  throw new Error(
    [`the ${label} capture is unusable and cannot be compared:`,
      ...problems.map((problem) => `  - ${problem}`),
    ].join("\n"),
  );
}

/**
 * Field-by-field diff of the comparison key. Scenario name and viewer counts
 * are deliberately outside that key: varying them is the point of a
 * comparison, not a reason to refuse one.
 */
export function findCaptureIncompatibilities(baselineCapture, candidateCapture) {
  const baseline = captureComparisonKey(baselineCapture);
  const candidate = captureComparisonKey(candidateCapture);
  const reasons = [];
  for (const field of Object.keys(baseline)) {
    if (describe(baseline[field]) !== describe(candidate[field])) {
      reasons.push(
        `${field} differs: baseline ${describe(baseline[field])} vs `
        + `candidate ${describe(candidate[field])}`,
      );
    }
  }
  return reasons;
}

function unavailableReason(summary) {
  return summary?.value === null && summary?.reason ? summary.reason : null;
}

function seriesNames(baselineSeries, candidateSeries) {
  return [...new Set([...Object.keys(baselineSeries), ...Object.keys(candidateSeries)])];
}

function compareSeries(baselineSummary, candidateSummary) {
  const rows = [];
  const skipped = [];
  const baselineSeries = baselineSummary?.series ?? {};
  const candidateSeries = candidateSummary?.series ?? {};
  for (const series of seriesNames(baselineSeries, candidateSeries)) {
    const baseline = baselineSeries[series];
    const candidate = candidateSeries[series];
    if (!baseline || !candidate) {
      const absent = baseline ? "candidate" : "baseline";
      skipped.push(
        `${series} is absent from the ${absent} capture; it is not compared against nothing`,
      );
      continue;
    }
    const baselineReason = unavailableReason(baseline);
    const candidateReason = unavailableReason(candidate);
    if (baselineReason || candidateReason) {
      const side = baselineReason ? "baseline" : "candidate";
      skipped.push(
        `${series} is unavailable in the ${side} capture — ${baselineReason ?? candidateReason}`,
      );
      continue;
    }
    if (baseline.count === 0 || candidate.count === 0) {
      skipped.push(`${series} has no samples in one capture`);
      continue;
    }
    const deltaBytes = candidate.median - baseline.median;
    rows.push({
      series,
      baselineMedian: baseline.median,
      candidateMedian: candidate.median,
      deltaBytes,
      deltaPercent: baseline.median === 0 ? null : (deltaBytes / baseline.median) * 100,
      baselineSamples: baseline.count,
      candidateSamples: candidate.count,
      quantilesApproximate: Boolean(
        baseline.quantilesApproximate || candidate.quantilesApproximate,
      ),
    });
  }
  return { rows, skipped };
}

function conditionsOf(baselineCapture, candidateCapture) {
  const conditions = {};
  for (const field of CONDITION_FIELDS) {
    conditions[field] = {
      baseline: baselineCapture.scenario?.[field] ?? null,
      candidate: candidateCapture.scenario?.[field] ?? null,
    };
  }
  return conditions;
}

function endpoint(capture) {
  return {
    scenario: capture.scenario?.name ?? null,
    webContentPid: capture.attribution?.webContentPid ?? null,
    capturedAt: capture.capturedAt ?? null,
  };
}

export function compareCaptures(baselineCapture, candidateCapture, { informational = false } = {}) {
  // Structural validity is not negotiable by a flag: an unattributed or
  // sampleless capture is not evidence, informational or not.
  assertReadable(baselineCapture, "baseline");
  assertReadable(candidateCapture, "candidate");

  const incompatibilities = findCaptureIncompatibilities(baselineCapture, candidateCapture);
  const compatible = incompatibilities.length === 0;
  if (!compatible && !informational) {
    const error = new Error(
      ["these captures may not be compared as a memory signal:",
        ...incompatibilities.map((reason) => `  - ${reason}`),
        "rerun with --informational to compare them anyway",
      ].join("\n"),
    );
    error.incompatibilities = incompatibilities;
    throw error;
  }

  const { rows, skipped } = compareSeries(baselineCapture.summary, candidateCapture.summary);
  return {
    baseline: endpoint(baselineCapture),
    candidate: endpoint(candidateCapture),
    compatible,
    informational,
    incompatibilities,
    skipped,
    conditions: conditionsOf(baselineCapture, candidateCapture),
    rows,
    note:
      "A delta here is the difference between two sets of conditions — the "
      + "viewer counts, active runs and document state listed above — and not "
      + "an established cause of the memory difference. No pass or fail "
      + "threshold is applied; read a delta against capture-to-capture variance "
      + "measured on this machine before calling it a regression.",
  };
}
