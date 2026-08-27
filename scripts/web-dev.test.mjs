import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { productIdentity } from "./product-identity.mjs";

import {
  buildWebDevelopmentEnvironment,
  buildWebFrontendCommand,
  buildWebHookRunnerCommand,
  cleanupTemporaryWebLaunch,
  parseWebDevOptions,
  selectWebPort,
  waitUntilGraphqlReady,
} from "./web-dev.mjs";

const installedDataDirectory = path.join(
  "/users/ticketry/.config",
  productIdentity.defaultDataDirectoryName,
);

test("web development accepts only the disposable-data option", () => {
  assert.deepEqual(parseWebDevOptions([]), { temporarySqlite: false });
  assert.deepEqual(parseWebDevOptions(["--temp-sqlite"]), { temporarySqlite: true });
  assert.deepEqual(parseWebDevOptions(["--", "--temp-sqlite"]), { temporarySqlite: true });
  assert.throws(() => parseWebDevOptions(["--unknown"]), /usage: npm run web/);
});

test("an explicit data directory bypasses product data discovery", () => {
  let discoveryCalls = 0;
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: { MUXED_DATA_DIR: "../ticketry-web-data", PRESERVED: "yes" },
    resolveProductData() {
      discoveryCalls += 1;
    },
  });
  assert.equal(launch.dataDirectory, "/ticketry-web-data");
  assert.equal(launch.productDataDirectory, null);
  assert.equal(launch.temporaryProfile, false);
  assert.equal(discoveryCalls, 0);
  assert.equal(launch.environment.PRESERVED, "yes");
  assert.equal(launch.environment.MUXED_DATA_DIR, "/ticketry-web-data");
  assert.equal("MUXED_FORCE_SQLITE" in launch.environment, false);
  assert.match(launch.environment.MUXED_TMUX_SOCKET, /^muxed-dev-[0-9a-f]{16}$/);
  assert.equal("WORKTRACKER_BASE_URL" in launch.environment, false);
});

test("web development uses the installed desktop profile and tmux namespace", () => {
  const calls = [];
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: { HOME: "/users/ticketry" },
    resolveProductData(options) {
      calls.push(options);
      return installedDataDirectory;
    },
  });

  assert.deepEqual(calls, [{
    cwd: "/repository",
    environment: { HOME: "/users/ticketry" },
  }]);
  assert.equal(launch.dataDirectory, installedDataDirectory);
  assert.equal(launch.productDataDirectory, installedDataDirectory);
  assert.equal(launch.temporaryProfile, false);
  assert.equal(launch.temporarySqlite, false);
  assert.equal("MUXED_FORCE_SQLITE" in launch.environment, false);
  assert.equal(launch.environment.MUXED_TMUX_SOCKET, "muxed");
});

test("an explicit tmux namespace is preserved for the product profile", () => {
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: {
      HOME: "/users/ticketry",
      MUXED_TMUX_SOCKET: "ticketry-product-test",
    },
    resolveProductData() {
      return installedDataDirectory;
    },
  });

  assert.equal(launch.environment.MUXED_TMUX_SOCKET, "ticketry-product-test");
});

test("temporary web development creates and cleans one isolated profile", () => {
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: {},
    temporarySqlite: true,
  });
  assert.equal(launch.temporarySqlite, true);
  assert.equal(launch.temporaryProfile, true);
  assert.equal(launch.productDataDirectory, null);
  assert.equal(launch.environment.MUXED_FORCE_SQLITE, "true");
  assert.equal(existsSync(launch.dataDirectory), true);
  cleanupTemporaryWebLaunch(launch);
  assert.equal(existsSync(launch.dataDirectory), false);
});

test("web shutdown leaves the shared product profile in place", () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "ticketry-shared-profile-test-"));
  const marker = path.join(dataDirectory, "state.db");
  writeFileSync(marker, "product data");

  cleanupTemporaryWebLaunch({
    dataDirectory,
    temporaryProfile: false,
    environment: { MUXED_TMUX_SOCKET: "muxed" },
  });

  assert.equal(existsSync(marker), true);
  rmSync(dataDirectory, { recursive: true });
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

test("web development stops waiting when the GraphQL adapter exits", async () => {
  await assert.rejects(
    waitUntilGraphqlReady(8790, 180_000, () => true),
    /GraphQL adapter stopped before it became ready/,
  );
});
