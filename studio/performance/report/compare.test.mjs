import assert from "node:assert/strict";
import test from "node:test";

import { compareRuns, findIncompatibilities } from "./compare.mjs";
import { REPORT_SCHEMA_VERSION } from "./schema.mjs";

function metadata(overrides = {}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runIdentifier: "run-a",
    engine: "chromium",
    buildMode: "optimized-vite-build-with-source-maps",
    adapterProfile: "debug",
    headless: true,
    viewport: { width: 1440, height: 960 },
    dataset: { size: "small", version: 3, counts: { modules: 5, workItems: 100 } },
    captures: [],
    machine: {
      platform: "darwin",
      architecture: "arm64",
      cpuModel: "Apple M3 Max",
      cpuCount: 14,
      totalMemoryBytes: 38_654_705_664,
    },
    ...overrides,
  };
}

function report(overrides = {}, scenarioOverrides = {}) {
  return {
    metadata: metadata(overrides),
    scenarios: [
      {
        scenario: "module-picker",
        repetitions: 20,
        warmups: 3,
        parameters: { searchTerm: "Perf Module 05" },
        timings: {
          pickerOpenFilterClose: {
            count: 20,
            median: 40,
            p95: 60,
            quantilesApproximate: true,
          },
        },
        ...scenarioOverrides,
      },
    ],
  };
}

test("identical runs are compatible and produce median deltas", () => {
  const comparison = compareRuns(
    report(),
    report({ runIdentifier: "run-b" }, {
      timings: {
        pickerOpenFilterClose: { count: 20, median: 50, p95: 70, quantilesApproximate: true },
      },
    }),
  );
  assert.equal(comparison.compatible, true);
  assert.equal(comparison.rows.length, 1);
  assert.equal(comparison.rows[0].deltaMs, 10);
  assert.equal(comparison.rows[0].deltaPercent, 25);
  assert.equal(comparison.rows[0].quantilesApproximate, true);
  assert.equal(comparison.threshold, null);
});

test("a different engine is refused rather than subtracted", () => {
  assert.throws(
    () => compareRuns(report(), report({ runIdentifier: "run-b", engine: "webkit" })),
    /engine differs/,
  );
});

test("a different machine class is refused", () => {
  assert.throws(
    () =>
      compareRuns(
        report(),
        report({
          runIdentifier: "run-b",
          machine: { ...metadata().machine, cpuModel: "Apple M1" },
        }),
      ),
    /machineClass differs/,
  );
});

test("a different dataset version is refused", () => {
  const incompatibilities = findIncompatibilities(
    metadata(),
    metadata({ dataset: { size: "small", version: 4, counts: null } }),
  );
  assert.ok(incompatibilities.some((reason) => reason.startsWith("datasetVersion differs")));
});

test("a different instrumentation mode is refused", () => {
  assert.throws(
    () => compareRuns(report(), report({ runIdentifier: "run-b", captures: ["cpu"] })),
    /captures differs/,
  );
});

test("informational comparison reports the mismatch instead of hiding it", () => {
  const comparison = compareRuns(
    report(),
    report({ runIdentifier: "run-b", engine: "webkit" }),
    { informational: true },
  );
  assert.equal(comparison.compatible, false);
  assert.equal(comparison.informational, true);
  assert.ok(comparison.incompatibilities.some((reason) => reason.startsWith("engine differs")));
  assert.equal(comparison.rows.length, 1);
});

test("differing scenario parameters are refused, and the timing is skipped", () => {
  assert.throws(
    () =>
      compareRuns(
        report(),
        report({ runIdentifier: "run-b" }, { repetitions: 40 }),
      ),
    /different scenario parameters/,
  );
});

test("a timing missing from one run is skipped rather than compared to nothing", () => {
  const comparison = compareRuns(
    report(),
    report({ runIdentifier: "run-b" }, { timings: {} }),
  );
  assert.equal(comparison.rows.length, 0);
  assert.ok(comparison.skipped.some((reason) => reason.includes("missing from one run")));
});

test("a scenario absent from the candidate is recorded as skipped", () => {
  const comparison = compareRuns(
    report(),
    report({ runIdentifier: "run-b" }, { scenario: "idle", timings: {} }),
  );
  assert.ok(comparison.skipped.some((reason) => reason.includes("absent from the candidate")));
});
