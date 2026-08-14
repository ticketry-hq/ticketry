import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearDevelopmentLogs,
  developmentLogPath,
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
