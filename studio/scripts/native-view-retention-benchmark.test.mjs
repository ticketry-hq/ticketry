import assert from "node:assert/strict";
import test from "node:test";

import { runPackagedRetentionBenchmark } from "./native-view-retention-benchmark.mjs";

test("the packaged benchmark measures each required count in a fresh app", async () => {
  const events = [];
  const result = await runPackagedRetentionBenchmark({
    counts: [1, 5, 20],
    openScenario: async (count) => {
      events.push(["open", count]);
      return {
        pid: 100 + count,
        executable: "/tmp/Ticketry.app/Contents/MacOS/ticketry",
        status: {
          requestedCount: count,
          createdCount: count,
          visibleCount: 1,
          selectedCount: 1,
          hiddenCount: count - 1,
        },
        close: async () => events.push(["close", count]),
      };
    },
    captureScenario: async ({ count, pid }) => {
      events.push(["capture", count, pid]);
      return { schemaVersion: 1, scenario: { viewCount: count } };
    },
    settleScenario: async (count, scenario) => events.push(["settle", count, scenario.pid]),
  });

  assert.deepEqual(events, [
    ["open", 1], ["settle", 1, 101], ["capture", 1, 101], ["close", 1],
    ["open", 5], ["settle", 5, 105], ["capture", 5, 105], ["close", 5],
    ["open", 20], ["settle", 20, 120], ["capture", 20, 120], ["close", 20],
  ]);
  assert.deepEqual(result.map(({ scenario }) => scenario.viewCount), [1, 5, 20]);
});

test("a benchmark status must prove one selected view and every other view hidden", async () => {
  let closed = false;
  await assert.rejects(
    runPackagedRetentionBenchmark({
      counts: [5],
      openScenario: async () => ({
        pid: 105,
        executable: "/tmp/Ticketry.app/Contents/MacOS/ticketry",
        status: {
          requestedCount: 5,
          createdCount: 5,
          visibleCount: 2,
          selectedCount: 1,
          hiddenCount: 3,
        },
        close: async () => { closed = true; },
      }),
      captureScenario: async () => {
        throw new Error("invalid native inventory must not be sampled");
      },
    }),
    /did not prove the requested native-view state/,
  );
  assert.equal(closed, true);
});
