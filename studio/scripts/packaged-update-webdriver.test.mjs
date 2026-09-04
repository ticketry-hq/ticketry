import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { startPackagedUpdateWebDriver } from "./packaged-update-webdriver.mjs";
import {
  executeDirectWebviewRequest,
} from "./packaged-update-webdriver-boundaries.mjs";

const VERSION_A = "1.4.0";
const VERSION_B = "1.5.0";

test("direct eval keeps asynchronous Tauri invokes off the WebDriver sync endpoint", async () => {
  const calls = [];
  const result = await executeDirectWebviewRequest(
    45123,
    { kind: "invoke", command: "desktop_update_check" },
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { value: { ok: true, value: { status: "available" } } };
        },
      };
    },
  );

  assert.deepEqual(result, { ok: true, value: { status: "available" } });
  assert.equal(calls[0].url, "http://127.0.0.1:45123/wdio/eval");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.window_label, "main");
  assert.match(body.script, /desktop_update_check/);
  assert.match(body.script, /__TAURI_INTERNALS__\.invoke/);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "ticketry-packaged-update-webdriver-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Map();
  const invocations = [];
  const deletedSessions = [];
  const sessions = [];
  const connectedPorts = [];
  let owner = { pid: 41, nonce: "owner-a" };
  const livePids = new Set([41]);

  const connect = async (port) => {
    connectedPorts.push(port);
    const session = {
      async execute(_script, request) {
        if (request.kind === "storage-write") {
          for (const [key, value] of Object.entries(request.values)) storage.set(key, value);
          return { ok: true };
        }
        if (request.kind === "storage-read") {
          return Object.fromEntries(request.keys.map((key) => [key, storage.get(key) ?? null]));
        }
        assert.equal(request.kind, "invoke");
        invocations.push([request.command, request.args]);
        if (request.command === "desktop_runtime_configuration") {
          return { ok: true, value: { service_health: { state: "ready" } } };
        }
        if (request.command === "desktop_update_check") {
          return {
            ok: true,
            value: {
              installed_version: VERSION_A,
              status: "available",
              available_version: VERSION_B,
              notes: "Acceptance release",
            },
          };
        }
        if (request.command === "desktop_update_download_and_install") {
          return { ok: true };
        }
        if (request.command === "desktop_update_restart") {
          livePids.delete(41);
          livePids.add(52);
          owner = { pid: 52, nonce: "owner-b" };
          return { ok: true };
        }
        throw new Error(`unexpected command ${request.command}`);
      },
      async deleteSession() {
        deletedSessions.push(session);
      },
    };
    sessions.push(session);
    return session;
  };

  const boundaries = {
    allocatePort: async () => 45123,
    findAppExecutable: async () => "/acceptance/Ticketry.app/Contents/MacOS/ticketry",
    spawnApp: () => ({ pid: 41, exitCode: null, signalCode: null }),
    connect,
    readLockOwner: async () => owner,
    isProcessAlive: (pid) => livePids.has(pid),
    stopPid: async (pid) => livePids.delete(pid),
    sqliteDump: async (_databasePath, pattern) => `${pattern}:stable`,
    waitFor: async (check) => {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const value = await check();
          if (value) return value;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error("fixture condition was not ready");
    },
  };

  return {
    boundaries,
    connectedPorts,
    dataDirectory: path.join(root, "data"),
    deletedSessions,
    home: path.join(root, "home"),
    invocations,
    livePids,
    sessions,
    storage,
  };
}

test("drives update commands and reconnects to the relaunched installed app", async (t) => {
  const state = await fixture(t);
  const driver = await startPackagedUpdateWebDriver({
    appPath: "/acceptance/Ticketry.app",
    dataDirectory: state.dataDirectory,
    home: state.home,
    versionA: VERSION_A,
    versionB: VERSION_B,
    boundaries: state.boundaries,
  });

  assert.deepEqual(await driver.browser.openInstalledApp(), {
    version: VERSION_A,
    healthy: true,
  });
  assert.deepEqual(await driver.browser.checkForUpdate(), {
    status: "available",
    version: VERSION_B,
  });
  assert.deepEqual(await driver.browser.confirmUpdate(), { status: "relaunching" });
  await driver.browser.waitForRelaunch();

  assert.deepEqual(await driver.browser.inspectApp(), {
    version: VERSION_B,
    healthy: true,
  });
  assert.equal(state.sessions.length, 2);
  assert.deepEqual(state.connectedPorts, [45123, 45123]);
  assert.equal(state.deletedSessions.length, 1);
  assert.deepEqual(state.invocations.map(([command]) => command), [
    "desktop_runtime_configuration",
    "desktop_runtime_configuration",
    "desktop_update_check",
    "desktop_update_download_and_install",
    "desktop_update_restart",
    "desktop_runtime_configuration",
    "desktop_runtime_configuration",
  ]);
  assert.deepEqual(await driver.processes.inspectCurrent(), {
    dataDirectoryLock: {
      releasedByVersion: VERSION_A,
      reacquiredByVersion: VERSION_B,
      clean: true,
    },
    active: [{ role: "app", version: VERSION_B, pid: 52 }],
    stranded: [],
  });
});

test("retries the WebDriver connection while the installed app starts", async (t) => {
  const state = await fixture(t);
  const connect = state.boundaries.connect;
  let attempts = 0;
  state.boundaries.connect = async (port) => {
    attempts += 1;
    if (attempts === 1) throw new Error("ECONNREFUSED");
    return connect(port);
  };
  const driver = await startPackagedUpdateWebDriver({
    appPath: "/acceptance/Ticketry.app",
    dataDirectory: state.dataDirectory,
    home: state.home,
    versionA: VERSION_A,
    versionB: VERSION_B,
    boundaries: state.boundaries,
  });

  assert.deepEqual(await driver.browser.openInstalledApp(), {
    version: VERSION_A,
    healthy: true,
  });
  assert.equal(attempts, 2);
  assert.deepEqual(state.connectedPorts, [45123]);
});

test("captures each required preservation category without returning login secrets", async (t) => {
  const state = await fixture(t);
  const driver = await startPackagedUpdateWebDriver({
    appPath: "/acceptance/Ticketry.app",
    dataDirectory: state.dataDirectory,
    home: state.home,
    versionA: VERSION_A,
    versionB: VERSION_B,
    boundaries: state.boundaries,
  });
  await driver.browser.openInstalledApp();

  const before = await driver.data.seedVersionA();
  const after = await driver.data.inspectCurrent();

  assert.deepEqual(after, before);
  assert.match(before.workTracker, /^[a-f0-9]{64}$/);
  assert.match(before.selectedWorkspace.database, /^[a-f0-9]{64}$/);
  assert.equal(before.selectedWorkspace.recentModule, "packaged-update-acceptance-module");
  assert.match(before.preferences.database, /^[a-f0-9]{64}$/);
  assert.equal(before.preferences.sidebarVisible, "false");
  assert.deepEqual(before.approvedExecutablePaths, {
    tools: [
      { path: "/usr/bin/false", tool: "codex" },
      { path: "/usr/bin/false", tool: "tmux" },
    ],
  });
  assert.match(before.compatibleAgentLoginState.codex, /^[a-f0-9]{64}$/);
  assert.match(before.compatibleAgentLoginState.claude, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(before).includes("acceptance-token"), false);
  assert.equal(
    JSON.parse(await readFile(path.join(state.home, ".codex", "auth.json"), "utf8")).token,
    "acceptance-token",
  );
});

test("keeps runtime error codes and derives actions from their user-visible messages", async (t) => {
  const state = await fixture(t);
  state.boundaries.connect = async () => ({
    async execute(_script, request) {
      if (request.kind !== "invoke") return {};
      if (request.command === "desktop_runtime_configuration") {
        return { ok: true, value: { service_health: { state: "ready" } } };
      }
      if (request.command === "desktop_update_check") {
        return {
          ok: false,
          error: {
            code: "update_feed_unreachable",
            message: "The stable channel update feed could not be reached. Check your connection and retry the update check.",
            retryable: true,
          },
        };
      }
      throw new Error(`unexpected command ${request.command}`);
    },
    async deleteSession() {},
  });
  const driver = await startPackagedUpdateWebDriver({
    appPath: "/acceptance/Ticketry.app",
    dataDirectory: state.dataDirectory,
    home: state.home,
    versionA: VERSION_A,
    versionB: VERSION_B,
    boundaries: state.boundaries,
  });
  await driver.browser.openInstalledApp();

  assert.deepEqual(await driver.browser.checkForUpdate(), {
    status: "error",
    error: {
      code: "update_feed_unreachable",
      message: "The stable channel update feed could not be reached. Check your connection and retry the update check.",
      action: "Check your connection and retry the update check.",
      retryable: true,
    },
  });
});

test("returns an updater signature refusal without replacing its runtime code", async (t) => {
  const state = await fixture(t);
  state.boundaries.connect = async () => ({
    async execute(_script, request) {
      if (request.command === "desktop_runtime_configuration") {
        return { ok: true, value: { service_health: { state: "ready" } } };
      }
      if (request.command === "desktop_update_check") {
        return {
          ok: true,
          value: { status: "available", available_version: VERSION_B },
        };
      }
      if (request.command === "desktop_update_download_and_install") {
        return {
          ok: false,
          error: {
            code: "update_signature_invalid",
            message: "Update rejected: invalid signature. Ticketry was not changed. Restore a trusted stable channel update and check again.",
            retryable: false,
          },
        };
      }
      if (request.kind === "storage-write") return { ok: true };
      if (request.kind === "storage-read") return {};
      throw new Error(`unexpected command ${request.command}`);
    },
    async deleteSession() {},
  });
  const driver = await startPackagedUpdateWebDriver({
    appPath: "/acceptance/Ticketry.app",
    dataDirectory: state.dataDirectory,
    home: state.home,
    versionA: VERSION_A,
    versionB: VERSION_B,
    boundaries: state.boundaries,
  });
  await driver.browser.openInstalledApp();
  await driver.browser.checkForUpdate();

  assert.deepEqual(await driver.browser.confirmUpdate(), {
    status: "refused",
    error: {
      code: "update_signature_invalid",
      message: "Update rejected: invalid signature. Ticketry was not changed. Restore a trusted stable channel update and check again.",
      action: "Restore a trusted stable channel update and check again.",
      retryable: false,
    },
  });
});

test("dispose is idempotent and stops the current lock owner", async (t) => {
  const state = await fixture(t);
  const stopped = [];
  state.boundaries.stopPid = async (pid) => {
    stopped.push(pid);
    state.livePids.delete(pid);
  };
  const driver = await startPackagedUpdateWebDriver({
    appPath: "/acceptance/Ticketry.app",
    dataDirectory: state.dataDirectory,
    home: state.home,
    versionA: VERSION_A,
    versionB: VERSION_B,
    boundaries: state.boundaries,
  });
  await driver.browser.openInstalledApp();

  await driver.dispose();
  await driver.dispose();

  assert.deepEqual(stopped, [41]);
  assert.equal(state.deletedSessions.length, 1);
});
