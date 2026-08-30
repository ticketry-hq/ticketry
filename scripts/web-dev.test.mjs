import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { productIdentity } from "./product-identity.mjs";
import {
  formatWebFrontendLogPayload,
  webFrontendLogPlugin,
} from "../studio/scripts/web-frontend-log-plugin.mjs";
import { loadWebDevDefaults } from "./web-dev-defaults.mjs";

import {
  buildWebDevelopmentEnvironment,
  buildWebFrontendCommand,
  buildWebHookRunnerCommand,
  cleanupTemporaryWebLaunch,
  configuredWebPort,
  parseWebDevOptions,
  selectWebPort,
  waitUntilGraphqlReady,
  withWebFileLogging,
} from "./web-dev.mjs";

const installedDataDirectory = path.join(
  "/users/ticketry/.config",
  productIdentity.defaultDataDirectoryName,
);

test("local web defaults apply without overriding explicit environment", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-web-defaults-test-"));
  const configPath = path.join(directory, "web-defaults.json");
  writeFileSync(configPath, JSON.stringify({
    environment: {
      MUXED_DATA_DIR: "/configured/data",
      MUXED_DESKTOP_MCP_PORT: "8124",
      MUXED_TMUX_SOCKET: "configured-socket",
    },
    logToFile: true,
  }));

  assert.deepEqual(loadWebDevDefaults({
    configPath,
    environment: { MUXED_DATA_DIR: "/explicit/data", PRESERVED: "yes" },
  }), {
    environment: {
      MUXED_DATA_DIR: "/explicit/data",
      MUXED_DESKTOP_MCP_PORT: "8124",
      MUXED_TMUX_SOCKET: "configured-socket",
      PRESERVED: "yes",
    },
    logToFile: true,
    reuseGraphqlAdapter: false,
  });
  rmSync(directory, { recursive: true });
});

test("missing local web defaults preserve the existing launcher behavior", () => {
  assert.deepEqual(loadWebDevDefaults({
    configPath: "/missing/ticketry-web-defaults.json",
    environment: { PRESERVED: "yes" },
  }), {
    environment: { PRESERVED: "yes" },
    logToFile: false,
    reuseGraphqlAdapter: false,
  });
});

test("authoritative local web defaults replace inherited profile settings", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ticketry-web-override-test-"));
  const configPath = path.join(directory, "web-defaults.json");
  writeFileSync(configPath, JSON.stringify({
    environment: {
      MUXED_DATA_DIR: "/configured/data",
      MUXED_DESKTOP_MCP_PORT: "8124",
    },
    overrideEnvironment: true,
    reuseGraphqlAdapter: true,
  }));

  const defaults = loadWebDevDefaults({
    configPath,
    environment: { MUXED_DATA_DIR: "/inherited/data" },
  });
  assert.deepEqual(defaults.environment, {
    MUXED_DATA_DIR: "/configured/data",
    MUXED_DESKTOP_MCP_PORT: "8124",
  });
  assert.equal(defaults.reuseGraphqlAdapter, true);
  rmSync(directory, { recursive: true });
});

test("adapter reuse validates configured ports without requiring availability", () => {
  assert.equal(configuredWebPort("8799", "adapter"), 8799);
  assert.throws(() => configuredWebPort("occupied", "adapter"), /adapter must be a port/);
  assert.throws(() => configuredWebPort("70000", "adapter"), /adapter must be a port/);
});

test("web development accepts the disposable-data and file-logging options", () => {
  assert.deepEqual(parseWebDevOptions([]), {
    developmentProfile: false,
    temporarySqlite: false,
    logToFile: false,
  });
  assert.deepEqual(parseWebDevOptions(["--temp-sqlite"]), {
    developmentProfile: false,
    temporarySqlite: true,
    logToFile: false,
  });
  assert.deepEqual(parseWebDevOptions(["--", "--log-to-file"]), {
    developmentProfile: false,
    temporarySqlite: false,
    logToFile: true,
  });
  assert.deepEqual(parseWebDevOptions(["--log-to-file", "--temp-sqlite"]), {
    developmentProfile: false,
    temporarySqlite: true,
    logToFile: true,
  });
  assert.deepEqual(parseWebDevOptions(["--development-profile"]), {
    developmentProfile: true,
    temporarySqlite: false,
    logToFile: false,
  });
  assert.throws(() => parseWebDevOptions(["--unknown"]), /usage: npm run web/);
});

test("web file logging reaches the browser and Rust adapter only when requested", () => {
  const inherited = {
    PRESERVED: "yes",
    MUXED_DEVELOPMENT_LOG_PATH: "/stale/log",
    VITE_TICKETRY_WEB_FILE_LOGGING: "true",
  };
  assert.deepEqual(withWebFileLogging(inherited, {
    enabled: false,
    logPath: "/workspace/ticketry.log",
  }), { PRESERVED: "yes" });
  assert.deepEqual(withWebFileLogging(inherited, {
    enabled: true,
    logPath: "/workspace/ticketry.log",
  }), {
    PRESERVED: "yes",
    MUXED_DEVELOPMENT_LOG_PATH: "/workspace/ticketry.log",
    VITE_TICKETRY_WEB_FILE_LOGGING: "true",
  });
});

test("web frontend logging validates and flattens browser records", () => {
  assert.equal(
    formatWebFrontendLogPayload({ level: "error", message: "move failed\nconflict" }),
    "[frontend][error] move failed\\nconflict",
  );
  assert.equal(formatWebFrontendLogPayload({ level: "fatal", message: "no" }), null);
  assert.equal(formatWebFrontendLogPayload({ level: "info", message: 42 }), null);
});

test("web frontend logging exposes its route only when enabled", async () => {
  let disabledMiddleware;
  webFrontendLogPlugin({ enabled: false }).configureServer({
    middlewares: { use(candidate) { disabledMiddleware = candidate; } },
  });
  assert.equal(disabledMiddleware, undefined);

  let middleware;
  const lines = [];
  webFrontendLogPlugin({
    enabled: true,
    writeLine(line) { lines.push(line); },
  }).configureServer({
    middlewares: { use(candidate) { middleware = candidate; } },
  });

  const request = Readable.from([
    Buffer.from(JSON.stringify({ level: "info", message: "story move complete" })),
  ]);
  request.url = "/__ticketry/frontend-log";
  request.method = "POST";
  const headers = new Map();
  const response = {
    statusCode: 0,
    setHeader(name, value) { headers.set(name, value); },
    end(body = "") { this.body = body; },
  };
  await middleware(request, response, () => assert.fail("route should be handled"));

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, "");
  assert.equal(headers.get("cache-control"), "no-store");
  assert.deepEqual(lines, ["[frontend][info] story move complete"]);
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

test("web development mode uses the desktop per-worktree profile", () => {
  const calls = [];
  const developmentDataDirectory = "/users/ticketry/.config/ticketry-development/repository";
  const launch = buildWebDevelopmentEnvironment({
    cwd: "/repository",
    environment: { HOME: "/users/ticketry" },
    developmentProfile: true,
    resolveProductData() {
      assert.fail("development mode must not resolve product data");
    },
    resolveDevelopmentData(options) {
      calls.push(options);
      return developmentDataDirectory;
    },
  });

  assert.deepEqual(calls, [{
    cwd: "/repository",
    environment: { HOME: "/users/ticketry" },
  }]);
  assert.equal(launch.dataDirectory, developmentDataDirectory);
  assert.equal(launch.developmentProfile, true);
  assert.equal(launch.productDataDirectory, null);
  assert.match(launch.environment.MUXED_TMUX_SOCKET, /^muxed-dev-[0-9a-f]{16}$/);
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
