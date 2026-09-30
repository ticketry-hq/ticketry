/**
 * Comparing two independent profiling runs.
 *
 * The interesting work is refusal: a comparison across different engines,
 * machine classes, build modes, datasets, scenario parameters or
 * instrumentation modes is not a regression signal, and this module says so
 * instead of subtracting the numbers anyway. `--informational` acknowledges
 * the mismatch rather than hiding it.
 */
import { comparisonKey } from "./schema.mjs";

function describe(value) {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function findIncompatibilities(baselineMetadata, candidateMetadata) {
  const baseline = comparisonKey(baselineMetadata);
  const candidate = comparisonKey(candidateMetadata);
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

function scenarioParametersDiffer(baseline, candidate) {
  return JSON.stringify(baseline.parameters ?? {}) !== JSON.stringify(candidate.parameters ?? {})
    || baseline.repetitions !== candidate.repetitions
    || baseline.warmups !== candidate.warmups;
}

export function compareRuns(baselineReport, candidateReport, { informational = false } = {}) {
  const incompatibilities = findIncompatibilities(
    baselineReport.metadata,
    candidateReport.metadata,
  );
  const rows = [];
  const skipped = [];
  const candidateScenarios = new Map(
    candidateReport.scenarios.map((scenario) => [scenario.scenario, scenario]),
  );
  for (const baseline of baselineReport.scenarios) {
    const candidate = candidateScenarios.get(baseline.scenario);
    if (!candidate) {
      skipped.push(`${baseline.scenario} is absent from the candidate run`);
      continue;
    }
    if (scenarioParametersDiffer(baseline, candidate)) {
      const reason = `${baseline.scenario} ran with different scenario parameters`;
      incompatibilities.push(reason);
      if (!informational) {
        skipped.push(reason);
        continue;
      }
    }
    for (const [timing, baselineSummary] of Object.entries(baseline.timings ?? {})) {
      const candidateSummary = candidate.timings?.[timing];
      if (!candidateSummary || !baselineSummary) {
        skipped.push(`${baseline.scenario}/${timing} is missing from one run`);
        continue;
      }
      if (baselineSummary.count === 0 || candidateSummary.count === 0) {
        skipped.push(`${baseline.scenario}/${timing} has no samples in one run`);
        continue;
      }
      const deltaMs = candidateSummary.median - baselineSummary.median;
      rows.push({
        scenario: baseline.scenario,
        timing,
        baselineMedian: baselineSummary.median,
        candidateMedian: candidateSummary.median,
        baselineSamples: baselineSummary.count,
        candidateSamples: candidateSummary.count,
        deltaMs,
        deltaPercent: baselineSummary.median === 0
          ? null
          : (deltaMs / baselineSummary.median) * 100,
        quantilesApproximate: baselineSummary.quantilesApproximate
          || candidateSummary.quantilesApproximate,
      });
    }
  }
  const compatible = incompatibilities.length === 0;
  if (!compatible && !informational) {
    const error = new Error(
      ["these runs may not be compared as a regression signal:",
        ...incompatibilities.map((reason) => `  - ${reason}`),
        "rerun with --informational to compare them anyway",
      ].join("\n"),
    );
    error.incompatibilities = incompatibilities;
    throw error;
  }
  return {
    baseline: { runIdentifier: baselineReport.metadata.runIdentifier },
    candidate: { runIdentifier: candidateReport.metadata.runIdentifier },
    compatible,
    informational,
    incompatibilities,
    skipped,
    rows,
    threshold: null,
    note:
      "No pass or fail threshold is applied. Compare independent-run medians "
      + "against measured local variance before calling any delta a regression.",
  };
}
