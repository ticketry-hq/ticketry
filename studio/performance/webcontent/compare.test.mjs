import assert from "node:assert/strict";
import test from "node:test";

import { compareCaptures, findCaptureIncompatibilities } from "./compare.mjs";

const EXECUTABLE_SHA256 =
  "9f1c0c5a7f7b4a2d8e3c11f0b6a94d7e2c5480ab13d9f6e0c47a2b8d5e1f3096";

function merge(base, overrides) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const existing = base[key];
    const mergeable = value && typeof value === "object" && !Array.isArray(value)
      && existing && typeof existing === "object" && !Array.isArray(existing);
    result[key] = mergeable ? merge(existing, value) : value;
  }
  return result;
}

function distribution({
  count = 271,
  median,
  p95,
  max,
  min,
  netChange,
  range,
  quantilesApproximate = false,
}) {
  return { count, median, p95, max, min, netChange, range, quantilesApproximate };
}

function capture(overrides = {}) {
  return merge({
    schemaVersion: 1,
    kind: "webcontent-memory",
    capturedAt: "2026-09-04T09:12:44.201Z",
    scenario: {
      name: "two-visible-viewers",
      workload: "two visible terminal viewers, four retained, one active run",
      settleSeconds: 30,
      seconds: 300,
      intervalMs: 1000,
      visibleViewerCount: 2,
      retainedViewerCount: 4,
      activeRunCount: 1,
      documentState: "one document open",
    },
    build: {
      executable: "/Applications/Ticketry.app/Contents/MacOS/Ticketry",
      executableSha256: EXECUTABLE_SHA256,
      version: "0.9.4",
      buildMode: "packaged-release",
      source: { gitSha: "d3f16cf4", dirty: false },
    },
    machine: {
      model: "Mac16,6",
      macOS: "15.6.1",
      architecture: "arm64",
      logicalCpuCount: 14,
      totalMemoryBytes: 38_654_705_664,
    },
    attribution: {
      guiPid: 41_022,
      webContentPid: 41_067,
      evidence: "com.apple.WebKit.WebContent child of Ticketry pid 41022",
      reason: null,
    },
    instrumentation: { profiler: "footprint", diagnosticBuild: false },
    discontinuities: [],
    samples: [
      {
        at: "2026-09-04T09:12:44.201Z",
        webContent: { footprintBytes: 537_000_000, rssBytes: 611_000_000, cpuPercent: 3.1 },
        gui: { rssBytes: 214_000_000, cpuPercent: 1.4 },
      },
    ],
    summary: {
      sampleCount: 271,
      durationMs: 270_000,
      continuous: true,
      series: {
        footprintBytes: distribution({
          median: 537_000_000,
          p95: 559_000_000,
          max: 566_000_000,
          min: 502_000_000,
          netChange: 41_000_000,
          range: 64_000_000,
        }),
        webContentRssBytes: distribution({
          median: 611_000_000,
          p95: 640_000_000,
          max: 649_000_000,
          min: 574_000_000,
          netChange: 44_000_000,
          range: 75_000_000,
        }),
        webContentCpuPercent: distribution({
          median: 3.1,
          p95: 9.4,
          max: 18.2,
          min: 0.4,
          netChange: -0.7,
          range: 17.8,
        }),
      },
      retention: {
        settledBytes: 502_000_000,
        finalBytes: 543_000_000,
        releasedAfterCloseBytes: 12_000_000,
        interpretation: "footprint did not return to the settled level after viewers closed",
      },
      churn: {
        reclaimableMedianBytes: 38_000_000,
        dirtyMedianBytes: 197_000_000,
        interpretation: "WebKit malloc dirty pages dominate the footprint",
      },
    },
  }, overrides);
}

function candidateCapture(overrides = {}) {
  return capture(merge({
    capturedAt: "2026-09-04T10:41:07.884Z",
    scenario: {
      name: "six-visible-viewers",
      workload: "six visible terminal viewers, twelve retained, three active runs",
      visibleViewerCount: 6,
      retainedViewerCount: 12,
      activeRunCount: 3,
      documentState: "three documents open",
    },
    attribution: { webContentPid: 43_918 },
    summary: {
      series: {
        footprintBytes: distribution({
          median: 780_000_000,
          p95: 812_000_000,
          max: 828_000_000,
          min: 604_000_000,
          netChange: 173_000_000,
          range: 224_000_000,
        }),
        webContentRssBytes: distribution({
          median: 866_000_000,
          p95: 901_000_000,
          max: 918_000_000,
          min: 688_000_000,
          netChange: 178_000_000,
          range: 230_000_000,
        }),
        webContentCpuPercent: distribution({
          median: 6.2,
          p95: 21.5,
          max: 44.9,
          min: 0.6,
          netChange: 1.1,
          range: 44.3,
        }),
      },
    },
  }, overrides));
}

test("two captures of the same artifact and machine differing only in viewer count are compared per series", () => {
  const comparison = compareCaptures(capture(), candidateCapture());
  assert.equal(comparison.compatible, true);
  assert.equal(comparison.informational, false);
  assert.deepEqual(comparison.incompatibilities, []);
  assert.deepEqual(comparison.skipped, []);
  assert.equal(comparison.rows.length, 3);
  const footprint = comparison.rows.find((row) => row.series === "footprintBytes");
  assert.equal(footprint.baselineMedian, 537_000_000);
  assert.equal(footprint.candidateMedian, 780_000_000);
  assert.equal(footprint.deltaBytes, 243_000_000);
  assert.equal(footprint.deltaPercent.toFixed(1), "45.3");
  assert.equal(footprint.baselineSamples, 271);
  assert.equal(footprint.candidateSamples, 271);
  assert.equal(footprint.quantilesApproximate, false);
  assert.equal(comparison.baseline.scenario, "two-visible-viewers");
  assert.equal(comparison.baseline.webContentPid, 41_067);
  assert.equal(comparison.candidate.scenario, "six-visible-viewers");
  assert.equal(comparison.candidate.webContentPid, 43_918);
  assert.match(comparison.note, /not an established cause/);
  assert.match(comparison.note, /no pass or fail threshold/i);
});

test("a different packaged executable is refused rather than subtracted", () => {
  assert.throws(
    () =>
      compareCaptures(
        capture(),
        candidateCapture({
          build: {
            executableSha256:
              "1122334455667788990011223344556677889900112233445566778899001122",
          },
        }),
      ),
    (error) => {
      assert.match(error.message, /executableSha256 differs/);
      assert.match(error.message, /rerun with --informational to compare them anyway/);
      assert.ok(error.incompatibilities.some((reason) =>
        reason.startsWith("executableSha256 differs")));
      return true;
    },
  );
});

test("a different machine class is refused", () => {
  assert.throws(
    () => compareCaptures(capture(), candidateCapture({ machine: { model: "Mac14,6" } })),
    /machineClass differs/,
  );
});

test("a different sampling interval is refused because the captures are not the same experiment", () => {
  const reasons = findCaptureIncompatibilities(
    capture(),
    candidateCapture({ scenario: { intervalMs: 250 } }),
  );
  assert.ok(reasons.some((reason) => reason.startsWith("intervalMs differs")));
  assert.throws(
    () => compareCaptures(capture(), candidateCapture({ scenario: { intervalMs: 250 } })),
    /intervalMs differs/,
  );
});

test("a diagnostic instrumented build is refused against the plain artifact", () => {
  assert.throws(
    () =>
      compareCaptures(
        capture(),
        candidateCapture({ instrumentation: { diagnosticBuild: true } }),
      ),
    /diagnosticBuild differs/,
  );
});

test("informational comparison reports the mismatch instead of hiding it", () => {
  const comparison = compareCaptures(
    capture(),
    candidateCapture({ instrumentation: { diagnosticBuild: true } }),
    { informational: true },
  );
  assert.equal(comparison.compatible, false);
  assert.equal(comparison.informational, true);
  assert.ok(comparison.incompatibilities.some((reason) =>
    reason.startsWith("diagnosticBuild differs")));
  assert.equal(comparison.rows.length, 3);
});

test("a series missing from one capture is skipped with a reason", () => {
  const candidate = candidateCapture();
  delete candidate.summary.series.webContentCpuPercent;
  const comparison = compareCaptures(capture(), candidate);
  assert.equal(comparison.rows.length, 2);
  assert.ok(comparison.skipped.some((reason) =>
    reason.includes("webContentCpuPercent") && reason.includes("candidate")));
});

test("a series that is unavailable in one capture is skipped carrying that reason", () => {
  const comparison = compareCaptures(
    capture(),
    candidateCapture({
      summary: {
        series: {
          footprintBytes: {
            value: null,
            reason: "footprint sampling failed: the WebContent process exited mid-capture",
          },
        },
      },
    }),
  );
  assert.ok(!comparison.rows.some((row) => row.series === "footprintBytes"));
  assert.ok(comparison.skipped.some((reason) =>
    reason.includes("footprint sampling failed: the WebContent process exited mid-capture")));
});

test("a capture with no attributed WebContent process is rejected outright, even informationally", () => {
  const unattributed = candidateCapture({
    attribution: {
      webContentPid: null,
      evidence: null,
      reason: "no com.apple.WebKit.WebContent child was found for the Ticketry process",
    },
  });
  assert.throws(
    () => compareCaptures(capture(), unattributed, { informational: true }),
    /attributed WebContent process is not evidence/,
  );
  assert.throws(() => compareCaptures(capture(), unattributed), /is not evidence/);
});

test("the conditions block records which workload dimensions differed", () => {
  const comparison = compareCaptures(capture(), candidateCapture());
  assert.deepEqual(comparison.conditions.visibleViewerCount, { baseline: 2, candidate: 6 });
  assert.deepEqual(comparison.conditions.retainedViewerCount, { baseline: 4, candidate: 12 });
  assert.deepEqual(comparison.conditions.activeRunCount, { baseline: 1, candidate: 3 });
  assert.deepEqual(comparison.conditions.documentState, {
    baseline: "one document open",
    candidate: "three documents open",
  });
});
