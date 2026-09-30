import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseStartupTraceRecords } from "./startup-trace-report.mjs";
import {
  awaitStartupRegressionReport,
  compareStartupTraces,
  renderStartupRegressionReport,
} from "./startup-trace-regression.mjs";

const desktop = (id, elapsedAdopt, elapsedReady) => [
  `2026-09-07T00:00:00.000Z [launcher][info] startup.timeline {"startup_id":"${id}","stage":"launcher-started","elapsed_ms":0,"duration_ms":0}`,
  `2026-09-07T00:00:01.000Z [startup][info] timeline {"startup_id":"${id}","stage":"process-started","elapsed_ms":0,"duration_ms":0}`,
  `2026-09-07T00:00:01.000Z [startup][info] timeline {"startup_id":"${id}","stage":"foundation-adopted","elapsed_ms":${elapsedAdopt},"duration_ms":${elapsedAdopt}}`,
  `2026-09-07T00:00:02.000Z [startup][info] timeline {"startup_id":"${id}","stage":"recovery-runtimes-ready","elapsed_ms":${elapsedReady},"duration_ms":${elapsedReady - elapsedAdopt}}`,
];
const frontend = (id, elapsed) => [
  `[frontend][info] [startup-trace] {"startup_id":"${id}","stage":"frontend-render-scheduled","elapsed_ms":20,"duration_ms":20}`,
  `[frontend][info] [startup-trace] {"startup_id":"${id}","stage":"frontend-workspace-restored","elapsed_ms":${elapsed},"duration_ms":${elapsed - 20}}`,
];
const history = [
  ...desktop("a", 300, 1300), ...frontend("fa", 110),
  ...desktop("b", 320, 1400), ...frontend("fb", 120),
  ...desktop("c", 310, 1200), ...frontend("fc", 100),
];

test("a startup within the median band is ok and the first one has no history", () => {
  const first = compareStartupTraces(parseStartupTraceRecords([...desktop("a", 300, 1300), ...frontend("fa", 110)]));
  assert.deepEqual(first.map((c) => [c.kind, c.regressed, c.baselineMs]), [["desktop", false, null], ["frontend", false, null]]);

  const steady = compareStartupTraces(parseStartupTraceRecords([...history, ...desktop("d", 330, 1500), ...frontend("fd", 130)]));
  assert.deepEqual(steady.map((c) => [c.kind, c.latestMs, c.baselineMs, c.regressed]), [
    ["desktop", 1500, 1300, false],
    ["frontend", 130, 110, false],
  ]);
  assert.match(renderStartupRegressionReport(steady), /^desktop  startup {3}1500 ms  \(median of last 3: 1300 ms\)  ok$/m);
});

test("a slower startup shouts and names the stage that grew", () => {
  const records = parseStartupTraceRecords([...history, ...desktop("d", 900, 1900), ...frontend("fd", 105)]);
  const comparisons = compareStartupTraces(records);
  assert.equal(comparisons[0].regressed, true);
  assert.equal(comparisons[1].regressed, false);
  const report = renderStartupRegressionReport(comparisons);
  assert.match(report, /^STARTUP TIME REGRESSION$/m);
  assert.match(report, /desktop: foundation-adopted took 900 ms, usually 310 ms/);
});

test("an incomplete startup is reported, never compared", () => {
  const records = parseStartupTraceRecords([...history, ...desktop("d", 300, 1300).slice(0, 3), ...frontend("fd", 100)]);
  const [desktopComparison] = compareStartupTraces(records);
  assert.equal(desktopComparison.complete, false);
  assert.equal(desktopComparison.regressed, false);
  assert.match(renderStartupRegressionReport(compareStartupTraces(records)), /desktop .* INCOMPLETE/);
});

test("the launcher waits for both final stages of its own launch before reporting", async () => {
  const logPath = path.join(mkdtempSync(path.join(tmpdir(), "startup-")), "ticketry.log");
  writeFileSync(logPath, [...history, ...desktop("d", 300, 1300).slice(0, 3)].join("\n"));
  let ticks = 0;
  const pending = awaitStartupRegressionReport({ logPath, startupId: "d", pollMs: 1, now: () => (ticks += 1) * 1000 });
  writeFileSync(logPath, [...history, ...desktop("d", 900, 1900), ...frontend("fd", 100)].join("\n"));
  assert.match(await pending, /STARTUP TIME REGRESSION/);

  assert.match(
    await awaitStartupRegressionReport({ logPath, startupId: "missing", pollMs: 1, timeoutMs: 3000, now: () => (ticks += 1) * 1000 }),
    /did not complete within 3s/,
  );
});
