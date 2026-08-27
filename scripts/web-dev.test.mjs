import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  buildWebDevelopmentEnvironment,
  buildWebFrontendCommand,
  buildWebHookRunnerCommand,
  cleanupTemporaryWebLaunch,
  parseWebDevOptions,
  selectWebPort,
} from "./web-dev.mjs";

test("web development accepts only the disposable-data option", () => {
  assert.deepEqual(parseWebDevOptions([]), { temporarySqlite: false });
  assert.deepEqual(parseWebDevOptions(["--temp-sqlite"]), { temporarySqlite: true });
  assert.deepEqual(parseWebDevOptions(["--", "--temp-sqlite"]), { temporarySqlite: true });
  assert.throws(() => parseWebDevOptions(["--unknown"]), /usage: npm run web/);
});

test("web development uses isolated Rust runtime state", () => {
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: { MUXED_DATA_DIR: "../ticketry-web-data", PRESERVED: "yes" },
  });
  assert.equal(launch.dataDirectory, "/ticketry-web-data");
  assert.equal(launch.environment.PRESERVED, "yes");
  assert.equal(launch.environment.MUXED_DATA_DIR, "/ticketry-web-data");
  assert.match(launch.environment.MUXED_TMUX_SOCKET, /^muxed-dev-[0-9a-f]{16}$/);
  assert.equal("WORKTRACKER_BASE_URL" in launch.environment, false);
});

test("temporary web development creates and cleans one isolated profile", () => {
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: {},
    temporarySqlite: true,
  });
  assert.equal(launch.temporarySqlite, true);
  assert.equal(existsSync(launch.dataDirectory), true);
  cleanupTemporaryWebLaunch(launch);
  assert.equal(existsSync(launch.dataDirectory), false);
});

test("frontend command opens a strict local Vite port", () => {
  assert.deepEqual(buildWebFrontendCommand(5191), [
    "npm", "run", "dev", "--workspace", "@worktracker/studio", "--",
    "--host", "127.0.0.1", "--port", "5191", "--strictPort", "--open",
  ]);
});

test("web development builds the hook runner beside Cargo debug binaries", () => {
  assert.deepEqual(buildWebHookRunnerCommand({
    cwd: "/repository",
    platform: "darwin",
  }), {
    command: "rustc",
    args: [
      "/repository/studio/src-tauri/native/ticketry_hook.rs",
      "--edition",
      "2021",
      "-o",
      "/repository/studio/src-tauri/target/debug/ticketry-hook",
    ],
    output: "/repository/studio/src-tauri/target/debug/ticketry-hook",
  });
});

test("Rust adapter and frontend port selection shift independently", async () => {
  const occupied = new Set([5174, 8790]);
  const isAvailable = async (port) => !occupied.has(port);
  assert.equal(await selectWebPort({ firstPort: 5174, isAvailable }), 5175);
  assert.equal(await selectWebPort({ firstPort: 8790, isAvailable }), 8791);
  await assert.rejects(
    selectWebPort({ requestedPort: 8790, firstPort: 8790, isAvailable }),
    /Requested port 8790 is unavailable/,
  );
});

test("web development reserves the fixed MCP port", async () => {
  const available = async (port) => port !== 8123;
  await assert.rejects(
    selectWebPort({ requestedPort: 8123, firstPort: 8123, isAvailable: available }),
    /Requested port 8123 is unavailable/,
  );
  assert.equal(
    await selectWebPort({ requestedPort: 8123, firstPort: 8123, isAvailable: async () => true }),
    8123,
  );
});
