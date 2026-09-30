import assert from "node:assert/strict";
import test from "node:test";

import { TRACKED_SERIES } from "./schema.mjs";
import {
  impliedLiveIsNotAMeasurement,
  summarizeSeries,
  summarizeWebContentCapture,
} from "./summarize.mjs";

const MiB = 1024 * 1024;

/**
 * Byte figures below are the ones the originating ticket reported, so the
 * expectations read like the numbers an engineer would check by hand.
 */
const FOOTPRINT = [537 * MiB, 780 * MiB, 704 * MiB];
const WEBKIT_MALLOC_DIRTY = [443 * MiB, 645 * MiB, 613 * MiB];
const WEBKIT_MALLOC_RECLAIMABLE = [408 * MiB, 260 * MiB, 530 * MiB];

function buildSample(index, overrides = {}) {
  return {
    offsetMs: index * 5000,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 5)).toISOString(),
    webContent: {
      pid: 4242,
      footprintBytes: FOOTPRINT[index],
      rssBytes: FOOTPRINT[index] + 40 * MiB,
      cpuPercent: [11.5, 24.25, 7.75][index],
      categories: {
        "WebKit malloc": {
          dirty: WEBKIT_MALLOC_DIRTY[index],
          clean: 12 * MiB,
          reclaimable: WEBKIT_MALLOC_RECLAIMABLE[index],
          swapped: 0,
          regions: 918,
        },
      },
      reason: null,
    },
    gui: {
      pid: 4200,
      rssBytes: [180 * MiB, 190 * MiB, 195 * MiB][index],
      cpuPercent: [2.5, 4.5, 3.5][index],
      reason: null,
    },
    host: { memoryPressureLevel: "normal", swapUsedBytes: 0 },
    ...overrides,
  };
}

function buildCapture({ sampleCount = 3, discontinuities = [] } = {}) {
  return {
    schemaVersion: 1,
    kind: "webcontent-memory",
    capturedAt: "2026-01-01T00:00:00.000Z",
    scenario: {
      name: "three-viewers-idle",
      workload: "three document viewers held open while the window idles",
      settleSeconds: 30,
      seconds: 15,
      intervalMs: 5000,
      visibleViewerCount: 1,
      retainedViewerCount: 3,
      activeRunCount: 0,
      documentState: "loaded",
    },
    build: {
      executable: "/Applications/Ticketry.app/Contents/MacOS/Ticketry",
      executableSha256: "a".repeat(64),
      version: "0.1.0",
      buildMode: "release",
      source: "packaged",
    },
    machine: {
      model: "Mac16,6",
      macOS: "15.3",
      architecture: "arm64",
      logicalCpuCount: 14,
      totalMemoryBytes: 36 * 1024 * MiB,
    },
    attribution: {
      guiPid: 4200,
      webContentPid: 4242,
      evidence: "child of the GUI process running com.apple.WebKit.WebContent",
      reason: null,
    },
    instrumentation: { profiler: "footprint", diagnosticBuild: false },
    discontinuities,
    samples: Array.from({ length: sampleCount }, (_, index) => buildSample(index)),
  };
}

test("an empty series is unavailable with a reason rather than zero", () => {
  const summary = summarizeSeries([], { unit: "bytes" });
  assert.equal(summary.value, null);
  assert.match(summary.reason, /no samples/);
  assert.equal(summary.count, 0);
  assert.equal(summary.unit, "bytes");
  assert.equal(summary.median, undefined);
  assert.equal(summary.netChange, undefined);
});

test("a series of only unmeasured points stays unavailable rather than collapsing to zero", () => {
  const summary = summarizeSeries([null, undefined, Number.NaN], { unit: "bytes" });
  assert.equal(summary.value, null);
  assert.equal(summary.count, 0);
  assert.match(summary.reason, /no samples/);
});

test("series quantiles follow the harness nearest-rank convention and flag small samples", () => {
  const twenty = summarizeSeries(
    Array.from({ length: 20 }, (_, index) => index + 1),
    { unit: "bytes" },
  );
  assert.equal(twenty.count, 20);
  assert.equal(twenty.min, 1);
  assert.equal(twenty.median, 10);
  assert.equal(twenty.p95, 19);
  assert.equal(twenty.max, 20);
  assert.equal(twenty.mean, 10.5);
  assert.match(twenty.quantileConvention, /nearest-rank/);
  assert.equal(twenty.quantilesApproximate, true);

  const fifty = summarizeSeries(
    Array.from({ length: 50 }, (_, index) => index + 1),
    { unit: "bytes" },
  );
  assert.equal(fifty.count, 50);
  assert.equal(fifty.median, 25);
  assert.equal(fifty.p95, 48);
  assert.equal(fifty.quantilesApproximate, false);
});

test("net change and range are reported separately for a series that returns to where it started", () => {
  const summary = summarizeSeries([500 * MiB, 900 * MiB, 500 * MiB], { unit: "bytes" });
  assert.equal(summary.first, 524288000);
  assert.equal(summary.last, 524288000);
  assert.equal(summary.netChange, 0);
  assert.equal(summary.range, 419430400);
  assert.equal(summary.min, 524288000);
  assert.equal(summary.max, 943718400);
});

test("a monotonically growing series is flagged and an oscillating one is not", () => {
  const growing = summarizeSeries(WEBKIT_MALLOC_DIRTY.slice(0, 2), { unit: "bytes" });
  assert.equal(growing.monotonicNonDecreasing, true);

  const oscillating = summarizeSeries(WEBKIT_MALLOC_RECLAIMABLE, { unit: "bytes" });
  assert.equal(oscillating.monotonicNonDecreasing, false);

  const single = summarizeSeries([537 * MiB], { unit: "bytes" });
  assert.equal(single.count, 1);
  assert.equal(single.monotonicNonDecreasing, false);
});

test("a continuous capture reports retention as sustained growth of the footprint series", () => {
  const summary = summarizeWebContentCapture(buildCapture());
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.continuous, true);
  assert.equal(summary.durationMs, 10000);
  assert.equal(summary.retention.reason, null);
  assert.equal(summary.retention.basis, "footprintBytes");
  assert.equal(summary.retention.netChangeBytes, 175112192);
  assert.equal(summary.retention.monotonic, false);
  assert.ok(Math.abs(summary.retention.netChangePercent - 31.098) < 0.01);
});

test("retention is refused when the capture records a content-process restart", () => {
  const capture = buildCapture({
    discontinuities: [
      { atOffsetMs: 5000, kind: "webcontent-restart", detail: "pid 4242 replaced by pid 4311" },
    ],
  });
  const summary = summarizeWebContentCapture(capture);
  assert.equal(summary.continuous, false);
  assert.equal(summary.retention.value, null);
  assert.match(summary.retention.reason, /restart/);
  assert.match(summary.retention.reason, /different processes/);
  assert.equal(summary.retention.netChangeBytes, undefined);
});

test("churn is still reported across a restart but is marked as spanning one", () => {
  const continuous = summarizeWebContentCapture(buildCapture());
  assert.equal(continuous.churn.basis, "footprintBytes");
  assert.equal(continuous.churn.rangeBytes, 254803968);
  assert.ok(Math.abs(continuous.churn.rangePercentOfMedian - 34.517) < 0.01);
  assert.equal(continuous.churn.spansRestart, false);

  const restarted = summarizeWebContentCapture(
    buildCapture({
      discontinuities: [{ atOffsetMs: 5000, kind: "webcontent-gone", detail: "pid 4242 exited" }],
    }),
  );
  assert.equal(restarted.churn.rangeBytes, 254803968);
  assert.equal(restarted.churn.spansRestart, true);
  assert.match(restarted.churn.note, /restart/);
});

test("every tracked series appears in the summary, CPU series included", () => {
  const summary = summarizeWebContentCapture(buildCapture());
  for (const name of Object.keys(TRACKED_SERIES)) {
    assert.ok(summary.series[name], `${name} is missing from the summary`);
    assert.equal(summary.series[name].count, 3);
  }
  assert.equal(summary.series.footprintBytes.unit, "bytes");
  assert.equal(summary.series.footprintBytes.median, 738197504);
  assert.equal(summary.series.webKitMallocDirtyBytes.max, 676331520);
  assert.equal(summary.series.webKitMallocReclaimableBytes.max, 555745280);
  assert.equal(summary.series.webContentCpuPercent.unit, "percent");
  assert.equal(summary.series.webContentCpuPercent.max, 24.25);
  assert.equal(summary.series.guiCpuPercent.unit, "percent");
  assert.equal(summary.series.guiCpuPercent.min, 2.5);
  assert.equal(summary.series.guiRssBytes.count, 3);
});

test("a capture with one sample reports duration as unavailable rather than zero", () => {
  const summary = summarizeWebContentCapture(buildCapture({ sampleCount: 1 }));
  assert.equal(summary.sampleCount, 1);
  assert.equal(summary.durationMs.value, null);
  assert.match(summary.durationMs.reason, /at least two samples/);
});

test("the interpretation separates reclaimable pages and allocation churn from a live heap", () => {
  const { interpretation } = summarizeWebContentCapture(buildCapture());
  assert.match(interpretation, /reclaimable/i);
  assert.match(interpretation, /returned to the OS/i);
  assert.match(interpretation, /allocation activity/i);
  assert.match(interpretation, /live JavaScript heap/i);
});

test("the module carries the correction that implied live memory is not a measurement", () => {
  assert.equal(typeof impliedLiveIsNotAMeasurement, "string");
  assert.match(impliedLiveIsNotAMeasurement, /dirty/i);
  assert.match(impliedLiveIsNotAMeasurement, /reclaimable/i);
  assert.match(impliedLiveIsNotAMeasurement, /arithmetic/i);
  assert.match(impliedLiveIsNotAMeasurement, /not a measured live JavaScript heap/i);
});
