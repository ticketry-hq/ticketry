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
import { productIdentity } from "../../scripts/product-identity.mjs";

import {
  buildDesktopHookRunnerCommand,
  createTemporarySqliteProfile,
  formatDevelopmentIdentity,
  parseDesktopDevOptions,
  parseDesktopDevMode,
  removeTemporarySqliteProfile,
  prepareDesktopHookRunner,
  resolveDevelopmentDataDirectory,
  resolveDevelopmentLogPath,
  resolveDevelopmentTmuxSocket,
  resolveTauriCliPath,
  selectFrontendPort,
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
  assert.equal(
    path.dirname(direct),
    path.join(
      parent,
      ".config",
      `${productIdentity.defaultDataDirectoryName}-development`,
    ),
  );
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

test("development logs use one stable workspace-local location", () => {
  assert.equal(
    resolveDevelopmentLogPath({ root: "/repository" }),
    "/repository/.ticketry-dev/logs/ticketry.log",
  );
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

test("explicit frontend ports fail instead of shifting", async () => {
  await assert.rejects(
    selectFrontendPort({
      requestedPort: 43210,
      isAvailable: async (port) => port !== 43210,
    }),
    /Requested frontend port 43210 is unavailable/,
  );
});

test("desktop development selects the first free frontend port", async () => {
  const checked = [];
  const port = await selectFrontendPort({
    isAvailable: async (port) => {
      checked.push(port);
      return port !== 5174;
    },
  });

  assert.equal(port, 5175);
  assert.deepEqual(checked, [5174, 5175]);
});

test("desktop development accepts temporary SQLite mode", () => {
  assert.equal(parseDesktopDevMode([]), "isolated");
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
    /usage: pnpm --filter @worktracker\/studio desktop:dev -- \[--temp-sqlite\]/,
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

test("desktop development prepares the Tauri sidecar for the Rust host target", () => {
  assert.deepEqual(buildDesktopHookRunnerCommand({
    hostTarget: "x86_64-unknown-linux-gnu",
    root: "/repository",
    platform: "linux",
  }), {
    command: "rustc",
    args: [
      "/repository/studio/src-tauri/native/ticketry_hook.rs",
      "--edition",
      "2021",
      "-o",
      "/repository/studio/src-tauri/binaries/ticketry-hook-x86_64-unknown-linux-gnu",
    ],
  });
});

test("desktop development builds the sidecar before launching Tauri", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ticketry-desktop-hook-test-"));
  const calls = [];
  prepareDesktopHookRunner({
    root,
    rustcVersion: () => "rustc 1.95.0\nhost: aarch64-apple-darwin\n",
    runner(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "rustc");
  assert.equal(
    calls[0].args.at(-1),
    path.join(root, "studio/src-tauri/binaries/ticketry-hook-aarch64-apple-darwin"),
  );
  assert.equal(existsSync(path.dirname(calls[0].args.at(-1))), true);
  rmSync(root, { recursive: true });
});

test("startup identity is one concise non-secret report with all selected resources", () => {
  const report = formatDevelopmentIdentity({
    frontendOrigin: "http://127.0.0.1:5175",
    dataDirectory: "/tmp/muxed-profile",
    tmuxSocket: "muxed-dev-0123456789abcdef",
  });

  assert.equal(
    report,
    "Ticketry Dev instance: frontend=http://127.0.0.1:5175 runtime=in-process-rust data=/tmp/muxed-profile tmux=muxed-dev-0123456789abcdef",
  );
  assert.equal(report.split("\n").length, 1);
  assert.doesNotMatch(report, /token|credential|secret/i);
});
