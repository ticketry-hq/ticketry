import assert from "node:assert/strict";
import test from "node:test";

import { watchTemporaryProfile } from "./temporary-profile-watchdog.mjs";

test("the watchdog waits for its launcher and then removes only its temporary profile", () => {
  const calls = [];
  let checks = 0;
  watchTemporaryProfile({
    dataDirectory: "/temporary/ticketry-temp-sqlite-launch",
    parentProcessId: 42,
    tmuxSocket: "muxed-dev-launch",
    isAlive(processId) {
      calls.push(["alive", processId]);
      checks += 1;
      return checks === 1;
    },
    schedule(callback, delay) {
      calls.push(["schedule", delay]);
      callback();
    },
    cleanup(dataDirectory) {
      calls.push(["cleanup", dataDirectory]);
    },
    stopTmux(tmuxSocket) {
      calls.push(["tmux", tmuxSocket]);
    },
    profileExists(dataDirectory) {
      calls.push(["exists", dataDirectory]);
      return true;
    },
  });

  assert.deepEqual(calls, [
    ["alive", 42],
    ["schedule", 250],
    ["alive", 42],
    ["exists", "/temporary/ticketry-temp-sqlite-launch"],
    ["cleanup", "/temporary/ticketry-temp-sqlite-launch"],
    ["tmux", "muxed-dev-launch"],
  ]);
});
