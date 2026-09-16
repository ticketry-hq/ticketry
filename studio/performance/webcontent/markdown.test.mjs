import assert from "node:assert/strict";
import { test } from "node:test";

import { renderCaptureMarkdown } from "./markdown.mjs";

function capture(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "webcontent-memory",
    capturedAt: "2026-09-05T06:17:53.767Z",
    scenario: {
      name: "packaged-live-workspace",
      workload: "packaged release window on the live workspace",
      settleSeconds: 30,
      seconds: 180,
      intervalMs: 2000,
      visibleViewerCount: 0,
      retainedViewerCount: 0,
      activeRunCount: 0,
      documentState: "no document open",
    },
    build: { executable: "/Applications/Ticketry.app/Contents/MacOS/ticketry", executableSha256: "abc", version: "0.2.0", buildMode: "packaged" },
    machine: { model: "Mac14,9", macOS: "26.2", architecture: "arm64", logicalCpuCount: 10, totalMemoryBytes: 17179869184 },
    attribution: {
      guiPid: 66450,
      webContentPid: 66454,
      reason: null,
      evidence: {
        rule: "single WebKit content process launched inside the GUI launch window",
        offsetSeconds: 1,
        windowSeconds: 60,
        rejectedPids: [23434, 81515],
      },
    },
    instrumentation: { profiler: "footprint --json + ps", diagnosticBuild: false },
    discontinuities: [],
    samples: [],
    summary: {
      sampleCount: 79,
      durationMs: 179_100,
      continuous: true,
      series: {},
      retention: { basis: "footprintBytes", netChangeBytes: -20_237_516, netChangePercent: -4.05123 },
      churn: { basis: "footprintBytes", rangeBytes: 391_233_536, rangePercentOfMedian: 79.4368747544306, spansRestart: false },
    },
    ...overrides,
  };
}

test("attribution evidence is rendered as readable text, never as a stringified object", () => {
  const markdown = renderCaptureMarkdown(capture());

  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.match(markdown, /single WebKit content process launched inside the GUI launch window/);
  assert.match(markdown, /1 s after/);
});

test("the content processes the rule rejected are named, so the reader can check the choice", () => {
  assert.match(renderCaptureMarkdown(capture()), /23434, 81515/);
});

test("an unattributed capture says so instead of printing a process line", () => {
  const markdown = renderCaptureMarkdown(capture({
    attribution: { guiPid: 66450, webContentPid: null, evidence: null, reason: "3 candidates" },
  }));

  assert.match(markdown, /unattributed — 3 candidates/);
});

test("a recorded discontinuity is rendered with its kind and detail, not as 'no reason recorded'", () => {
  const markdown = renderCaptureMarkdown(capture({
    discontinuities: [{
      atOffsetMs: 42_000,
      kind: "webcontent-restart",
      detail: "content process 66454 exited while 70001 is running",
    }],
    summary: { ...capture().summary, continuous: false },
  }));

  assert.match(markdown, /webcontent-restart/);
  assert.match(markdown, /content process 66454 exited while 70001 is running/);
  assert.match(markdown, /42\.0 s/);
  assert.doesNotMatch(markdown, /no reason recorded/);
});

test("percentages are rounded to one decimal rather than printed at float precision", () => {
  const markdown = renderCaptureMarkdown(capture());

  assert.match(markdown, /79\.4%/);
  assert.doesNotMatch(markdown, /79\.4368747544306/);
});
