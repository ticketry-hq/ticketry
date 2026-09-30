import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCaptureSet,
  parseProcessTable,
  renderReport,
  summarizeSamples,
} from "./native-view-resource-measurement.mjs";

test("process sampling excludes spawned agent and tmux workloads", () => {
  const observed = parseProcessTable(`
  10 1 1.5 100 ticketry
  11 10 2.5 200 WebKit.WebContent
  12 11 0.5 300 nested-helper
  20 1 9.0 900 unrelated
`, 10);
  assert.equal(observed.cpuPercent, 1.5);
  assert.equal(observed.rssBytes, 100 * 1024);
  assert.deepEqual(observed.processes.map(({ pid }) => pid), [10]);
});

test("sample summaries use steady percentiles rather than the last sample", () => {
  const summary = summarizeSamples([
    { cpuPercent: 1, rssBytes: 100 },
    { cpuPercent: 9, rssBytes: 900 },
    { cpuPercent: 3, rssBytes: 300 },
  ]);
  assert.equal(summary.cpuMedianPercent, 3);
  assert.equal(summary.cpuP95Percent, 9);
  assert.equal(summary.rssMedianBytes, 300);
  assert.equal(summary.rssP95Bytes, 900);
});

function capture(viewCount, cpuP95Percent, rssP95MiB, overrides = {}) {
  return {
    schemaVersion: 1,
    scenario: {
      viewCount,
      visibleCount: 1,
      selectedCount: 1,
      seconds: 60,
      intervalMs: 1000,
      workload: "idle after 30 second settling period",
      ...overrides.scenario,
    },
    process: { sampleCount: 60 },
    build: { executableSha256: "abc", ...overrides.build },
    machine: {
      model: "Mac15,3",
      macOS: "15.6",
      architecture: "arm64",
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      ...overrides.machine,
    },
    summary: {
      cpuP95Percent,
      rssP95Bytes: rssP95MiB * 1024 * 1024,
    },
  };
}

test("the retention limit is the largest measured count within declared budgets", () => {
  const analysis = analyzeCaptureSet([
    capture(1, 1, 200),
    capture(5, 1.5, 250),
    capture(20, 3, 400),
  ], { incrementalCpuPercent: 1, incrementalMemoryPercent: 1 });
  assert.equal(analysis.retentionLimit, 5);
  assert.equal(analysis.rows[1].incrementalRssPerViewMiB, 12.5);
  assert.equal(analysis.rows[1].incrementalCpuPercent, 0.5);
  assert.equal(analysis.budgets.incrementalRssMiB, 163.84);
  assert.match(renderReport(analysis), /Measured warm retention limit: \*\*5 native views\*\*/);
});

test("the report refuses to extrapolate when a required packaged count is absent", () => {
  assert.throws(
    () => analyzeCaptureSet([capture(1, 1, 200), capture(5, 2, 300)], {
      incrementalCpuPercent: 1,
      incrementalMemoryPercent: 1,
    }),
    /missing packaged captures for 20 native views/,
  );
});

test("captures must use one executable, machine, and workload", () => {
  assert.throws(
    () => analyzeCaptureSet([
      capture(1, 1, 200),
      capture(5, 2, 300, { build: { executableSha256: "different" } }),
      capture(20, 3, 400),
    ], { incrementalCpuPercent: 1, incrementalMemoryPercent: 1 }),
    /different packaged executables/,
  );
});

test("short captures cannot decide the retention limit", () => {
  assert.throws(
    () => analyzeCaptureSet([
      capture(1, 1, 200, { scenario: { seconds: 10 } }),
      capture(5, 2, 300, { scenario: { seconds: 10 } }),
      capture(20, 3, 400, { scenario: { seconds: 10 } }),
    ], { incrementalCpuPercent: 1, incrementalMemoryPercent: 1 }),
    /scenario seconds must be at least 60/,
  );
});

test("physical memory is required to apply the percentage budget", () => {
  assert.throws(
    () => analyzeCaptureSet([
      capture(1, 1, 200, { machine: { totalMemoryBytes: undefined } }),
      capture(5, 2, 300, { machine: { totalMemoryBytes: undefined } }),
      capture(20, 3, 400, { machine: { totalMemoryBytes: undefined } }),
    ]),
    /machine totalMemoryBytes must be greater than zero/,
  );
});
