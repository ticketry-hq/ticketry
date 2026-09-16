import assert from "node:assert/strict";
import test from "node:test";

import {
  quantile,
  summarizeCpuProfile,
  summarizeRetention,
  summarizeScenario,
  summarizeTimings,
} from "./summarize.mjs";

test("quantile uses nearest rank on ascending samples", () => {
  const values = [5, 1, 4, 2, 3];
  assert.equal(quantile(values, 0.5), 3);
  assert.equal(quantile(values, 0.95), 5);
  assert.equal(quantile(values, 0), 1);
  assert.equal(quantile([], 0.5), null);
});

test("an empty timing list is unavailable with a reason, not zero", () => {
  const summary = summarizeTimings([]);
  assert.equal(summary.value, null);
  assert.equal(summary.count, 0);
  assert.match(summary.reason, /no samples/);
  assert.equal(summary.median, undefined);
});

test("timings carry their sample count and flag approximate quantiles", () => {
  const twenty = summarizeTimings(Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(twenty.count, 20);
  assert.equal(twenty.median, 10);
  assert.equal(twenty.p95, 19);
  assert.equal(twenty.max, 20);
  assert.equal(twenty.quantilesApproximate, true);

  const fifty = summarizeTimings(Array.from({ length: 50 }, (_, index) => index));
  assert.equal(fifty.quantilesApproximate, false);
});

test("non-finite samples are discarded rather than counted as zero", () => {
  const summary = summarizeTimings([10, Number.NaN, 20, null, undefined]);
  assert.equal(summary.count, 2);
  assert.equal(summary.median, 10);
});

test("CPU summarization charges self time to the sampled node only", () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: -1, columnNumber: -1 } },
      {
        id: 2,
        callFrame: { functionName: "hot", url: "http://app/a.js", lineNumber: 4, columnNumber: 9 },
        hitCount: 3,
      },
      {
        id: 3,
        callFrame: { functionName: "cold", url: "http://app/b.js", lineNumber: 1, columnNumber: 1 },
        hitCount: 1,
      },
    ],
    samples: [2, 2, 3, 2],
    timeDeltas: [100, 100, 50, 100],
    startTime: 0,
    endTime: 350,
  };
  const summary = summarizeCpuProfile(profile);
  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.attributedUs, 350);
  assert.equal(summary.frames[0].functionName, "hot");
  assert.equal(summary.frames[0].selfTimeUs, 300);
  assert.equal(Math.round(summary.frames[0].selfPercent), 86);
  assert.equal(summary.frames[1].selfTimeUs, 50);
  assert.equal(summary.frames[0].unresolved, false);
});

test("a frame without a script URL stays labelled unresolved", () => {
  const summary = summarizeCpuProfile({
    nodes: [{ id: 1, callFrame: { functionName: "(garbage collector)", url: "" } }],
    samples: [1],
    timeDeltas: [500],
  });
  assert.equal(summary.frames[0].unresolved, true);
  assert.equal(summary.frames[0].url, null);
});

test("an empty CPU profile is unavailable with a reason", () => {
  assert.match(summarizeCpuProfile(null).reason, /no node table/);
  assert.match(
    summarizeCpuProfile({ nodes: [], samples: [], timeDeltas: [] }).reason,
    /no samples/,
  );
});

test("retention separates warmup growth from continued growth", () => {
  const summary = summarizeRetention([
    { usedJsHeapBytes: 100, domNodeCount: 10 },
    { usedJsHeapBytes: 200, domNodeCount: 20 },
    { usedJsHeapBytes: 205, domNodeCount: 20 },
    { usedJsHeapBytes: 204, domNodeCount: 20 },
  ]);
  assert.equal(summary.heapGrowthBytes, 104);
  assert.equal(summary.heapGrowthBytesAfterWarmup, 4);
  assert.equal(summary.heapGrowsEveryBatchAfterWarmup, false);
  assert.match(summary.interpretation, /lead, not a leak/);
});

test("retention needs at least two batches", () => {
  assert.match(summarizeRetention([{ usedJsHeapBytes: 1 }]).reason, /at least two/);
  assert.match(summarizeRetention(undefined).reason, /at least two/);
});

test("a scenario with a partial failure keeps both its samples and its failures", () => {
  const summary = summarizeScenario({
    scenario: "module-picker",
    engine: "chromium",
    status: "failed",
    parameters: { repetitions: 20, warmups: 3 },
    timings: {
      pickerOpenFilterClose: [10, 12, 11],
      "pickerOpenFilterClose.failed": [5000],
    },
    operationWindows: { measured: { WorkTrackerModuleOpen: { count: 4, totalMs: 40, maxMs: 15 } } },
    failures: ["pickerOpenFilterClose: timed out"],
  });
  assert.equal(summary.status, "failed");
  assert.equal(summary.repetitions, 20);
  assert.equal(summary.warmups, 3);
  assert.equal(summary.timings.pickerOpenFilterClose.count, 3);
  assert.equal(summary.timings["pickerOpenFilterClose.failed"].count, 1);
  assert.equal(summary.operations.measured.totalOperations, 4);
  assert.deepEqual(summary.failures, ["pickerOpenFilterClose: timed out"]);
  assert.match(summary.retention.reason, /no retention batches/);
});

test("cpu attribution is split by script origin and unresolved frames stay separate", () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: "(idle)", url: "" } },
      { id: 2, callFrame: { functionName: "render", url: "http://127.0.0.1:4273/assets/app.js", lineNumber: 3, columnNumber: 9 } },
      { id: 3, callFrame: { functionName: "computeAriaRole", url: "" } },
    ],
    samples: [1, 2, 3, 2],
    timeDeltas: [100, 300, 200, 400],
    startTime: 0,
    endTime: 1000,
  };
  const summary = summarizeCpuProfile(profile);
  assert.equal(summary.attributedUs, 1000);
  const origins = Object.fromEntries(
    summary.origins.map((entry) => [entry.origin, entry.selfTimeUs]),
  );
  assert.deepEqual(origins, { "http://127.0.0.1:4273": 700, "(unresolved)": 300 });
  assert.deepEqual(
    summary.applicationFrames.map((frame) => frame.functionName),
    ["render"],
  );
  assert.equal(summary.applicationFrames[0].unresolved, false);
});
