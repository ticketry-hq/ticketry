import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireRunLock } from "./run-lock.mjs";
import { assessHostNoise, readMacosMemoryPressureLevel } from "./host-load.mjs";
import {
  assessPreparation,
  PREPARATION_SCHEMA_VERSION,
  stalePreparationMessage,
} from "./provenance.mjs";

function temporaryLockPath() {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-perf-lock-"));
  return { directory, lockPath: path.join(directory, "run.lock") };
}

test("a second run in the same checkout is refused while the first is alive", (t) => {
  const { directory, lockPath } = temporaryLockPath();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = acquireRunLock({ lockPath, runIdentifier: "run-a", pid: 4242 });
  assert.throws(
    () =>
      acquireRunLock({
        lockPath,
        runIdentifier: "run-b",
        pid: 4243,
        isRunning: () => true,
      }),
    /another profiling run is active/,
  );
  first.release();
  assert.equal(existsSync(lockPath), false);
});

test("a lock left by a dead process is taken over instead of blocking forever", (t) => {
  const { directory, lockPath } = temporaryLockPath();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  acquireRunLock({ lockPath, runIdentifier: "crashed", pid: 4242, isRunning: () => false });
  const next = acquireRunLock({
    lockPath,
    runIdentifier: "run-b",
    pid: 4243,
    isRunning: () => false,
  });
  assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).runIdentifier, "run-b");
  next.release();
});

test("releasing twice is harmless", (t) => {
  const { directory, lockPath } = temporaryLockPath();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const lock = acquireRunLock({ lockPath, runIdentifier: "run-a", pid: 1 });
  lock.release();
  lock.release();
  assert.equal(existsSync(lockPath), false);
});

test("host noise is reported, never acted on", () => {
  const quiet = assessHostNoise([{
    loadAverage: { oneMinute: 1 },
    cpuCount: 10,
    freeMemoryBytes: 8e9,
    totalMemoryBytes: 32e9,
    memoryPressureLevel: { value: 1 },
  }]);
  assert.equal(quiet.noisy, false);

  const busy = assessHostNoise([{
    loadAverage: { oneMinute: 24 },
    cpuCount: 10,
    freeMemoryBytes: 1e9,
    totalMemoryBytes: 32e9,
    memoryPressureLevel: { value: 2 },
  }]);
  assert.equal(busy.noisy, true);
  assert.equal(busy.reasons.length, 3);
});

test("memory pressure is unavailable rather than normal off macOS", () => {
  const result = readMacosMemoryPressureLevel({ platform: "linux" });
  assert.equal(result.value, null);
  assert.match(result.reason, /unsupported platform linux/);
});

test("a changed source fingerprint makes the prepared bundle stale", () => {
  const record = {
    schemaVersion: PREPARATION_SCHEMA_VERSION,
    source: { sourceFingerprint: "aaa" },
    adapter: { profile: "debug", builtAtMs: 1_000 },
  };
  const assessment = assessPreparation(record, {
    fingerprint: { sourceFingerprint: "bbb" },
    adapterProfile: "debug",
    adapterBinary: "/adapter",
    buildDirectory: "/bundle",
    exists: () => true,
    stat: () => ({ mtimeMs: 1_000 }),
  });
  assert.equal(assessment.current, false);
  assert.ok(assessment.reasons.some((reason) => reason.includes("fingerprint changed")));
  assert.match(stalePreparationMessage(assessment.reasons), /npm run perf:prepare/);
});

test("an adapter rebuilt after preparation makes the run stale", () => {
  const assessment = assessPreparation({
    schemaVersion: PREPARATION_SCHEMA_VERSION,
    source: { sourceFingerprint: "aaa" },
    adapter: { profile: "debug", builtAtMs: 1_000 },
  }, {
    fingerprint: { sourceFingerprint: "aaa" },
    adapterProfile: "debug",
    adapterBinary: "/adapter",
    buildDirectory: "/bundle",
    exists: () => true,
    stat: () => ({ mtimeMs: 9_000 }),
  });
  assert.equal(assessment.current, false);
  assert.ok(assessment.reasons.some((reason) => reason.includes("rebuilt after preparation")));
});

test("a missing preparation record names itself as the reason", () => {
  const assessment = assessPreparation(null, {
    fingerprint: { sourceFingerprint: "aaa" },
    adapterProfile: "debug",
    adapterBinary: "/adapter",
    buildDirectory: "/bundle",
  });
  assert.deepEqual(assessment.reasons, ["no prepared build was recorded"]);
});
