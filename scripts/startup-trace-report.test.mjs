import assert from "node:assert/strict";
import test from "node:test";

import {
  latestStartupTrace,
  parseStartupTraceRecords,
  renderStartupTraceReport,
} from "./startup-trace-report.mjs";

test("startup reports retain the latest launcher and desktop trace", () => {
  const records = parseStartupTraceRecords([
    '2026-09-05T00:00:00.000Z [launcher][info] startup.timeline {"startup_id":"old","stage":"launcher-started","elapsed_ms":0,"duration_ms":0}',
    '2026-09-05T00:00:01.000Z [launcher][info] startup.timeline {"startup_id":"latest","stage":"launcher-started","elapsed_ms":0,"duration_ms":0}',
    '2026-09-05T00:00:04.000Z [startup][info] timeline {"startup_id":"latest","stage":"process-started","elapsed_ms":3000,"duration_ms":3000}',
    '2026-09-05T00:00:05.000Z [frontend][info] [startup-trace] {"startup_id":"webview","stage":"frontend-runtime-configured","elapsed_ms":80,"duration_ms":40}',
  ]);

  assert.deepEqual(latestStartupTrace(records).map(({ stage }) => stage), [
    "launcher-started",
    "process-started",
  ]);
  assert.match(renderStartupTraceReport(records), /\+  3000 ms  process-started/);
  assert.match(renderStartupTraceReport(records), /Frontend startup trace webview/);
});
