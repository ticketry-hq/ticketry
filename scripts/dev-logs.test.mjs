import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearDevelopmentLogs,
  developmentLogPath,
  launchTraceReportFromLog,
  recentLogLines,
  workspaceRoot,
} from "./dev-logs.mjs";

test("the development log has one stable workspace-local location", () => {
  assert.equal(
    developmentLogPath,
    path.join(workspaceRoot, ".ticketry-dev", "logs", "ticketry.log"),
  );
});

test("recent logs include rotations in chronological order", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-dev-logs-"));
  const logPath = path.join(directory, "ticketry.log");
  writeFileSync(`${logPath}.2`, "oldest\n");
  writeFileSync(`${logPath}.1`, "older\n");
  writeFileSync(logPath, "current-one\ncurrent-two\n");

  assert.deepEqual(recentLogLines({ logPath, limit: 3 }), [
    "older",
    "current-one",
    "current-two",
  ]);
  rmSync(directory, { recursive: true });
});

test("clearing truncates the active log and removes only known rotations", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-dev-logs-"));
  const logPath = path.join(directory, "ticketry.log");
  writeFileSync(logPath, "current\n");
  writeFileSync(`${logPath}.1`, "older\n");
  writeFileSync(`${logPath}.2`, "oldest\n");
  writeFileSync(path.join(directory, "keep.txt"), "keep\n");

  clearDevelopmentLogs(logPath);

  assert.equal(readFileSync(logPath, "utf8"), "");
  assert.equal(existsSync(`${logPath}.1`), false);
  assert.equal(existsSync(`${logPath}.2`), false);
  assert.equal(readFileSync(path.join(directory, "keep.txt"), "utf8"), "keep\n");
  rmSync(directory, { recursive: true });
});

test("renders one Agent Run trace across rotated development logs", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-launch-trace-"));
  const logPath = path.join(directory, "ticketry.log");
  writeFileSync(
    `${logPath}.1`,
    '2026-08-31T08:30:00.100Z [backend][info] launch-discovery {"event":"launch-transaction-committed","timestamp":"2026-08-31T08:30:00.100Z","agentRunId":"run-1373"}\n',
  );
  writeFileSync(
    logPath,
    '2026-08-31T08:30:00.150Z [frontend:stdout] [frontend][info] [launch-discovery] {"event":"workspace-render-committed","timestamp":"2026-08-31T08:30:00.150Z","agentRunId":"run-1373"}\n',
  );

  const output = launchTraceReportFromLog("run-1373", logPath);

  assert.match(output, /Status: completed/);
  assert.match(output, /Last stage: workspace-render-committed/);
  assert.match(output, /workspace-render-committed .* \+50 ms/);
  assert.throws(
    () => launchTraceReportFromLog("missing-run", logPath),
    /no launch-discovery records found for Agent Run missing-run/,
  );
  rmSync(directory, { recursive: true });
});

test("renders a trace by launch attempt before an Agent Run exists", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-launch-attempt-"));
  const logPath = path.join(directory, "ticketry.log");
  writeFileSync(
    logPath,
    '2026-08-31T08:30:00.100Z [backend][info] launch-discovery {"event":"launch-requested","timestamp":"2026-08-31T08:30:00.100Z","launchAttemptId":"attempt-only","agentRunId":null,"launchSurface":"dependency-graph","outcome":"admitted"}\n',
  );

  const output = launchTraceReportFromLog("attempt-only", logPath);

  assert.match(output, /Launch trace: attempt-only/);
  assert.match(output, /Status: incomplete/);
  assert.match(output, /Last stage: launch-requested/);
  rmSync(directory, { recursive: true });
});
