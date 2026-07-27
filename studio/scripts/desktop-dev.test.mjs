import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildConnectLaunch,
  formatDevelopmentIdentity,
  parseDesktopDevMode,
  resolveDevelopmentDataDirectory,
  selectDevelopmentServicePorts,
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
  const firstOccupied = new Set([8787, 8797]);
  const first = await selectDevelopmentServicePorts({
    environment: {},
    isAvailable: async (port) => !firstOccupied.has(port),
  });
  const secondOccupied = new Set([...firstOccupied, first.backend, first.mcp]);
  const second = await selectDevelopmentServicePorts({
    environment: {},
    isAvailable: async (port) => !secondOccupied.has(port),
  });

  assert.deepEqual(first, { backend: 8788, mcp: 8798 });
  assert.deepEqual(second, { backend: 8789, mcp: 8799 });
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

test("--connect is the only supported desktop development argument", () => {
  assert.equal(parseDesktopDevMode([]), "isolated");
  assert.equal(parseDesktopDevMode(["--connect"]), "connect");
  assert.equal(parseDesktopDevMode(["--", "--connect"]), "connect");
  assert.throws(
    () => parseDesktopDevMode(["--unknown"]),
    /usage: pnpm --filter @worktracker\/studio desktop:dev -- --connect/,
  );
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
  });

  assert.equal(
    report,
    "Muxed desktop development instance: frontend=http://127.0.0.1:5175 backend=http://127.0.0.1:8788 mcp=http://127.0.0.1:8798/mcp data=/tmp/muxed-profile",
  );
  assert.equal(report.split("\n").length, 1);
  assert.doesNotMatch(report, /token|credential|secret/i);
});
