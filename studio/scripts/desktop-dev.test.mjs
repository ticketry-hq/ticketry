import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
  createTemporarySqliteProfile,
  formatDevelopmentIdentity,
  parseDesktopDevOptions,
  parseDesktopDevMode,
  removeTemporarySqliteProfile,
  resolveDevelopmentDataDirectory,
  resolveDevelopmentLogPath,
  resolveDevelopmentTmuxSocket,
  resolveTauriCliPath,
  seedDevelopmentDataDirectory,
  selectFrontendPort,
  selectMcpPort,
  stopTemporaryTmuxServer,
} from "./desktop-dev.mjs";
import { addLinkedWorktree, createRepository } from "./git-fixtures.mjs";

test("a development-only override wins exactly without consulting Git", () => {
  const selected = resolveDevelopmentDataDirectory({
    cwd: "/definitely/not/a/repository",
    environment: { TICKETRY_DEV_DATA_DIR: "../exact profile" },
  });

  assert.equal(selected, "../exact profile");
});

test("the product runtime data override cannot redirect desktop development", () => {
  const { parent, repository } = createRepository("isolated from product override");
  const selected = resolveDevelopmentDataDirectory({
    cwd: repository,
    environment: {
      HOME: parent,
      MUXED_DATA_DIR: path.join(parent, "live-product-data"),
    },
  });

  assert.match(selected, /worktracker-studio-rust-development/);
  assert.notEqual(selected, path.join(parent, "live-product-data"));
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

test("a new development profile is populated from a read-only product snapshot", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ticketry-seeded-development-"));
  const product = path.join(root, "product");
  const development = path.join(root, "development", "worktree-profile");
  mkdirSync(product, { recursive: true });
  writeFileSync(path.join(product, "state.db"), "production rows");

  const seeded = seedDevelopmentDataDirectory({
    dataDirectory: development,
    productDataDirectory: product,
    createSnapshot({ sourceDirectory, temporaryRoot }) {
      assert.equal(sourceDirectory, product);
      const snapshot = path.join(temporaryRoot, "snapshot");
      mkdirSync(snapshot, { recursive: true });
      writeFileSync(path.join(snapshot, "state.db"), "copied rows");
      return snapshot;
    },
    prepareSnapshot(snapshot) {
      writeFileSync(path.join(snapshot, "sanitized"), "runtime ownership removed");
    },
  });

  assert.equal(seeded, true);
  assert.equal(readFileSync(path.join(development, "state.db"), "utf8"), "copied rows");
  assert.equal(
    readFileSync(path.join(development, "sanitized"), "utf8"),
    "runtime ownership removed",
  );
  assert.equal(readFileSync(path.join(product, "state.db"), "utf8"), "production rows");
  rmSync(root, { recursive: true });
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

test("desktop development selects an MCP port that does not collide with Ticketry", async () => {
  const checked = [];
  const port = await selectMcpPort({
    isAvailable: async (candidate) => {
      checked.push(candidate);
      return candidate !== 8123;
    },
  });

  assert.equal(port, 8124);
  assert.deepEqual(checked, [8123, 8124]);
});

test("desktop development accepts temporary SQLite mode", () => {
  assert.equal(parseDesktopDevMode([]), "isolated");
  assert.deepEqual(parseDesktopDevOptions(["--seed-from-product"]), {
    mode: "isolated",
    seedFromProduct: true,
    temporarySqlite: false,
  });
  assert.deepEqual(parseDesktopDevOptions(["--temp-sqlite"]), {
    mode: "isolated",
    seedFromProduct: false,
    temporarySqlite: true,
  });
  assert.deepEqual(parseDesktopDevOptions(["--", "--temp-sqlite"]), {
    mode: "isolated",
    seedFromProduct: false,
    temporarySqlite: true,
  });
  assert.throws(
    () => parseDesktopDevMode(["--unknown"]),
    /usage: pnpm --filter @worktracker\/studio desktop:dev -- \[--temp-sqlite\|--seed-from-product\]/,
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
