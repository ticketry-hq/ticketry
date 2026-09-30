import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCapture, inspectContinuity } from "./capture.mjs";

const WEB_CONTENT_COMMAND =
  "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/"
  + "com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent";
const GUI_COMMAND = "/Applications/Ticketry.app/Contents/MacOS/ticketry";

function processTable(pids) {
  return pids.map((pid) => ({
    pid,
    ppid: 1,
    startedAtMs: 0,
    command: pid === 8610 ? GUI_COMMAND : WEB_CONTENT_COMMAND,
  }));
}

test("a capture whose processes are all still running has no discontinuity", () => {
  assert.equal(
    inspectContinuity({
      guiPid: 8610,
      webContentPid: 8613,
      processTable: processTable([8610, 8613]),
    }),
    null,
  );
});

test("a vanished content process is a discontinuity naming the pid", () => {
  const found = inspectContinuity({
    guiPid: 8610,
    webContentPid: 8613,
    processTable: processTable([8610]),
  });

  assert.equal(found.kind, "webcontent-gone");
  assert.match(found.detail, /8613/);
});

test("a replacement content process is reported as a restart, never silently re-attributed", () => {
  const found = inspectContinuity({
    guiPid: 8610,
    webContentPid: 8613,
    processTable: processTable([8610, 9001]),
  });

  assert.equal(found.kind, "webcontent-restart");
  assert.match(found.detail, /9001/);
});

test("a vanished GUI process ends the capture rather than leaving an orphan sampled", () => {
  const found = inspectContinuity({
    guiPid: 8610,
    webContentPid: 8613,
    processTable: processTable([8613]),
  });

  assert.equal(found.kind, "gui-gone");
});

test("a built capture carries the attribution evidence and validates", () => {
  const capture = buildCapture({
    scenario: {
      name: "idle-no-viewers",
      workload: "packaged window, no run viewers open",
      settleSeconds: 30,
      seconds: 120,
      intervalMs: 2000,
      visibleViewerCount: 0,
      retainedViewerCount: 0,
      activeRunCount: 0,
      documentState: "no document open",
    },
    build: { executable: GUI_COMMAND, executableSha256: "abc", buildMode: "packaged-release" },
    machine: { model: "Mac14,9", macOS: "26.2", architecture: "arm64", totalMemoryBytes: 17179869184 },
    attribution: { guiPid: 8610, webContentPid: 8613, evidence: { rule: "launch window" }, reason: null },
    instrumentation: { profiler: "footprint(1)+ps(1)", diagnosticBuild: false },
    samples: [
      { offsetMs: 0, at: "2026-09-05T11:00:00Z", webContent: { pid: 8613, footprintBytes: 100 }, gui: {}, host: {} },
      { offsetMs: 2000, at: "2026-09-05T11:00:02Z", webContent: { pid: 8613, footprintBytes: 200 }, gui: {}, host: {} },
    ],
    discontinuities: [],
  });

  assert.equal(capture.schemaVersion, 1);
  assert.equal(capture.kind, "webcontent-memory");
  assert.equal(capture.attribution.webContentPid, 8613);
  assert.equal(capture.summary.sampleCount, 2);
  assert.equal(capture.summary.continuous, true);
});

test("a capture built with no attributed process is refused rather than written", () => {
  assert.throws(
    () => buildCapture({
      scenario: { name: "x", workload: "y", seconds: 1, intervalMs: 1, settleSeconds: 0 },
      build: { executableSha256: "abc" },
      machine: { macOS: "26.2" },
      attribution: { guiPid: 8610, webContentPid: null, evidence: null, reason: "ambiguous" },
      instrumentation: {},
      samples: [{ offsetMs: 0, webContent: {}, gui: {}, host: {} }],
      discontinuities: [],
    }),
    /without an attributed WebContent process/,
  );
});
