import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertInstalledTicketryIsNotRunning,
  buildConnectLaunch,
  createTemporarySqliteProfile,
  formatDevelopmentIdentity,
  parseDesktopDevOptions,
  parseDesktopDevMode,
  removeTemporarySqliteProfile,
  resolveDevelopmentDataDirectory,
  resolveDevelopmentTmuxSocket,
  resolveTauriCliPath,
  selectDevelopmentServicePorts,
  stopTemporaryTmuxServer,
} from "./desktop-dev.mjs";
import { addLinkedWorktree, createRepository } from "./git-fixtures.mjs";

test("a non-empty explicit override wins exactly without consulting Git", () => {
  const selected = resolveDevelopmentDataDirectory({
    cwd: "/definitely/not/a/repository",
    environment: { MUXED_DATA_DIR: "../exact profile" },
  });

  assert.equal(selected, "../exact profile");
});

test("the same canonical worktree has one stable profile", () => {
  const { parent, repository } = createRepository("stable profile");
  const linkedPath = path.join(parent, "repository-link");
  symlinkSync(repository, linkedPath);
  const environment = { HOME: parent };

  const direct = resolveDevelopmentDataDirectory({ cwd: repository, environment });
  const repeated = resolveDevelopmentDataDirectory({ cwd: repository, environment });
  const viaSymlink = resolveDevelopmentDataDirectory({ cwd: linkedPath, environment });

  assert.equal(direct, repeated);
  assert.equal(direct, viaSymlink);
  assert.match(path.basename(direct), /^stable-profile-[0-9a-f]{16}$/);
  assert.equal(path.dirname(direct), path.join(parent, ".config/worktracker-studio-development"));
  assert.throws(() => realpathSync(direct), /ENOENT/);
});

test("linked worktrees resolve distinct stable profiles", () => {
  const { parent, repository } = createRepository("primary");
  const linked = addLinkedWorktree(repository, path.join(parent, "linked"), "linked-fixture");
  const environment = { HOME: parent };

  const primaryProfile = resolveDevelopmentDataDirectory({ cwd: repository, environment });
  const linkedProfile = resolveDevelopmentDataDirectory({ cwd: linked, environment });

  assert.notEqual(primaryProfile, linkedProfile);
  assert.match(path.basename(primaryProfile), /-[0-9a-f]{16}$/);
  assert.match(path.basename(linkedProfile), /-[0-9a-f]{16}$/);
});

test("development tmux sockets are stable per isolated data directory", () => {
  const first = resolveDevelopmentTmuxSocket("/tmp/profile-one");
  const repeated = resolveDevelopmentTmuxSocket("/tmp/profile-one");
  const second = resolveDevelopmentTmuxSocket("/tmp/profile-two");

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.match(first, /^muxed-dev-[0-9a-f]{16}$/);
});

test("resolution outside a Git worktree fails closed with the launch directory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "muxed-desktop-dev-not-git-"));

  assert.throws(
    () => resolveDevelopmentDataDirectory({ cwd: directory, environment: { HOME: directory } }),
    (error) => {
      assert.match(error.message, /could not resolve a Git worktree/);
      assert.match(error.message, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    },
  );
});

test("development services select distinct available ports for each launch", async () => {
  const firstOccupied = new Set([8787, 8123]);
  const first = await selectDevelopmentServicePorts({
    environment: {},
    isAvailable: async (port) => !firstOccupied.has(port),
  });
  const secondOccupied = new Set([...firstOccupied, first.backend, first.mcp]);
  const second = await selectDevelopmentServicePorts({
    environment: {},
    isAvailable: async (port) => !secondOccupied.has(port),
  });

  assert.deepEqual(first, { backend: 8788, mcp: 8124 });
  assert.deepEqual(second, { backend: 8789, mcp: 8125 });
});

test("explicit development service ports fail instead of shifting", async () => {
  await assert.rejects(
    selectDevelopmentServicePorts({
      environment: { MUXED_DESKTOP_BACKEND_PORT: "43210" },
      isAvailable: async (port) => port !== 43210,
    }),
    /Requested backend port 43210 is unavailable/,
  );
});

test("temporary SQLite desktop attempts only the optional MCP port 8123", async () => {
  const checked = [];
  const ports = await selectDevelopmentServicePorts({
    environment: {},
    temporarySqlite: true,
    isAvailable: async (port) => {
      checked.push(port);
      return port !== 8123;
    },
  });

  assert.deepEqual(ports, { backend: 8787, mcp: 8123 });
  assert.deepEqual(checked, [8787]);
});

test("desktop development accepts connect or temporary SQLite mode", () => {
  assert.equal(parseDesktopDevMode([]), "isolated");
  assert.equal(parseDesktopDevMode(["--connect"]), "connect");
  assert.equal(parseDesktopDevMode(["--", "--connect"]), "connect");
  assert.deepEqual(parseDesktopDevOptions(["--temp-sqlite"]), {
    mode: "isolated",
    temporarySqlite: true,
  });
  assert.deepEqual(parseDesktopDevOptions(["--", "--temp-sqlite"]), {
    mode: "isolated",
    temporarySqlite: true,
  });
  assert.throws(
    () => parseDesktopDevMode(["--unknown"]),
    /usage: pnpm --filter @worktracker\/studio desktop:dev -- \[--connect \| --temp-sqlite\]/,
  );
});

test("temporary SQLite profiles are unique and removed on shutdown", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ticketry-profile-test-"));
  const first = createTemporarySqliteProfile({ temporaryRoot });
  const second = createTemporarySqliteProfile({ temporaryRoot });
  writeFileSync(path.join(first, "state.db"), "temporary database");

  assert.notEqual(first, second);
  assert.equal(existsSync(path.join(first, "state.db")), true);
  removeTemporarySqliteProfile(first, { temporaryRoot });
  assert.equal(existsSync(first), false);
  assert.equal(existsSync(second), true);
  removeTemporarySqliteProfile(second, { temporaryRoot });
  rmSync(temporaryRoot, { recursive: true });
});

test("temporary SQLite cleanup refuses an unrelated directory", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ticketry-profile-test-"));
  const unrelated = mkdtempSync(path.join(temporaryRoot, "unrelated-"));

  assert.throws(
    () => removeTemporarySqliteProfile(unrelated, { temporaryRoot }),
    /refusing to remove non-temporary Ticketry profile/,
  );
  assert.equal(existsSync(unrelated), true);
  rmSync(temporaryRoot, { recursive: true });
});

test("temporary SQLite shutdown stops only its unique tmux server", () => {
  const calls = [];
  stopTemporaryTmuxServer("muxed-dev-temporary", {
    runner(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  assert.deepEqual(calls, [{
    command: "tmux",
    args: ["-L", "muxed-dev-temporary", "kill-server"],
    options: { stdio: "ignore" },
  }]);
});

test("the Tauri CLI is resolved through the workspace dependency tree", () => {
  const requests = [];
  const resolved = resolveTauriCliPath((specifier) => {
    requests.push(specifier);
    return "/repository/node_modules/@tauri-apps/cli/tauri.js";
  });

  assert.equal(resolved, "/repository/node_modules/@tauri-apps/cli/tauri.js");
  assert.deepEqual(requests, ["@tauri-apps/cli/tauri.js"]);
});

test("desktop development rejects a running installed macOS app actionably", () => {
  assert.throws(
    () => assertInstalledTicketryIsNotRunning({
      platform: "darwin",
      runner(command, args, options) {
        assert.equal(command, "ps");
        assert.deepEqual(args, ["-axo", "pid=,comm="]);
        assert.deepEqual(options, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return [
          "  100 /usr/bin/example",
          "  321 /Applications/Ticketry.app/Contents/MacOS/ticketry",
          "  654 /repository/studio/src-tauri/target/debug/ticketry",
        ].join("\n");
      },
    }),
    /installed Ticketry app is still running.*PID 321.*Command-Q.*closing its window is not enough.*pnpm run dev/,
  );
});

test("desktop development allows raw debug processes and non-macOS hosts", () => {
  assert.doesNotThrow(() => assertInstalledTicketryIsNotRunning({
    platform: "darwin",
    runner: () => "654 /repository/studio/src-tauri/target/debug/ticketry\n",
  }));
  assert.doesNotThrow(() => assertInstalledTicketryIsNotRunning({
    platform: "linux",
    runner: () => {
      throw new Error("runner must not be called");
    },
  }));
});

test("connect mode reuses the established pnpm dev stack without a sidecar command", () => {
  const launch = buildConnectLaunch({
    environment: { HOME: "/tmp/connect-home", PRESERVED: "yes" },
  });

  assert.equal(
    launch.dataDirectory,
    "/tmp/connect-home/.config/worktracker-studio",
  );
  assert.equal(launch.frontendOrigin, "http://127.0.0.1:5174");
  assert.equal(launch.backendPort, 8787);
  assert.deepEqual(launch.config, {
    build: {
      beforeDevCommand: null,
      devUrl: "http://127.0.0.1:5174",
    },
  });
  assert.equal(launch.environment.PRESERVED, "yes");
  assert.equal(launch.environment.MUXED_DESKTOP_DEVELOPMENT_MODE, "connect");
  assert.equal(launch.environment.MUXED_DESKTOP_BACKEND_PORT, "8787");
  assert.equal(
    launch.environment.MUXED_DESKTOP_WORKTRACKER_API,
    "http://127.0.0.1:5174/api/work-tracker",
  );
  assert.equal(
    launch.environment.MUXED_DESKTOP_STATUS_WEBSOCKET,
    "ws://127.0.0.1:5174/ws/status",
  );
});

test("connect mode pins canonical stack ports while honoring its explicit data directory", () => {
  const launch = buildConnectLaunch({
    environment: {
      HOME: "/ignored",
      MUXED_DATA_DIR: "/tmp/shared-data",
      MUXED_FRONTEND_PORT: "5190",
      MUXED_DESKTOP_BACKEND_PORT: "8890",
    },
  });

  assert.equal(launch.dataDirectory, "/tmp/shared-data");
  assert.equal(launch.frontendOrigin, "http://127.0.0.1:5174");
  assert.equal(launch.backendPort, 8787);
  assert.equal(launch.environment.MUXED_DESKTOP_BACKEND_PORT, "8787");
});

test("startup identity is one concise non-secret report with all selected resources", () => {
  const report = formatDevelopmentIdentity({
    frontendOrigin: "http://127.0.0.1:5175",
    backendPort: 8788,
    mcpPort: 8798,
    dataDirectory: "/tmp/muxed-profile",
    tmuxSocket: "muxed-dev-0123456789abcdef",
  });

  assert.equal(
    report,
    "Ticketry desktop development instance: frontend=http://127.0.0.1:5175 backend=http://127.0.0.1:8788 mcp=http://127.0.0.1:8798/mcp data=/tmp/muxed-profile tmux=muxed-dev-0123456789abcdef",
  );
  assert.equal(report.split("\n").length, 1);
  assert.doesNotMatch(report, /token|credential|secret/i);
});
