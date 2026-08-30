import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { productIdentity } from "./product-identity.mjs";

import {
  createProductDataSnapshot,
  resolveEstablishedProductDataDirectory,
  resolveProductDataDirectory,
  sanitizeDevelopmentDataSnapshot,
} from "./product-data-snapshot.mjs";

const configuredPathVariable = productIdentity.dataDirectoryPathEnvironmentVariables[0];

test("the established product directory matches the installed desktop default", () => {
  assert.equal(
    resolveEstablishedProductDataDirectory({ environment: { HOME: "/users/ticketry" } }),
    path.join(
      "/users/ticketry/.config",
      productIdentity.defaultDataDirectoryName,
    ),
  );
  assert.equal(
    resolveEstablishedProductDataDirectory({
      cwd: "/repository",
      environment: {
        HOME: "/users/ticketry",
        [configuredPathVariable]: "../installed-data",
      },
    }),
    "/installed-data",
  );
});

test("the product data directory uses the installed Ticketry location", () => {
  assert.equal(
    resolveProductDataDirectory({ environment: { HOME: "/users/ticketry" } }),
    path.join(
      "/users/ticketry/.config",
      productIdentity.defaultDataDirectoryName,
    ),
  );
  assert.equal(
    resolveProductDataDirectory({
      cwd: "/repository",
      environment: {
        HOME: "/users/ticketry",
        [configuredPathVariable]: "../installed-data",
      },
    }),
    "/installed-data",
  );
});

test("a product snapshot uses SQLite backup and copies browser-visible companions", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ticketry-product-snapshot-test-"));
  const source = path.join(fixtureRoot, "product");
  const temporaryRoot = path.join(fixtureRoot, "temporary");
  mkdirSync(path.join(source, "media"), { recursive: true });
  mkdirSync(temporaryRoot);
  writeFileSync(path.join(source, "state.db"), "source state");
  writeFileSync(path.join(source, "rust-core.sqlite3"), "source foundation");
  writeFileSync(path.join(source, "profiles.json"), "profiles");
  writeFileSync(path.join(source, "media", "document.txt"), "document");
  const calls = [];

  const snapshot = createProductDataSnapshot({
    sourceDirectory: source,
    temporaryRoot,
    runner(command, args, options) {
      calls.push({ command, args, options });
      const destination = args[1].match(/^\.backup '(.+)'$/)?.[1];
      writeFileSync(destination, `snapshot of ${path.basename(args[0])}`);
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ command, args }) => [command, path.basename(args[0])]), [
    ["sqlite3", "state.db"],
    ["sqlite3", "rust-core.sqlite3"],
  ]);
  assert.equal(readFileSync(path.join(snapshot, "state.db"), "utf8"), "snapshot of state.db");
  assert.equal(readFileSync(path.join(snapshot, "profiles.json"), "utf8"), "profiles");
  assert.equal(readFileSync(path.join(snapshot, "media", "document.txt"), "utf8"), "document");
  rmSync(fixtureRoot, { recursive: true });
});

test("development sanitization removes runtime ownership without touching product data", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ticketry-development-sanitize-"));
  const product = path.join(fixtureRoot, "product.db");
  const snapshot = path.join(fixtureRoot, "snapshot", "state.db");
  mkdirSync(path.dirname(snapshot), { recursive: true });
  writeFileSync(product, "product rows");
  writeFileSync(snapshot, "snapshot rows");
  const calls = [];

  sanitizeDevelopmentDataSnapshot({
    snapshotDirectory: path.dirname(snapshot),
    runner(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "sqlite3");
  assert.equal(calls[0].args[0], snapshot);
  assert.match(calls[0].args[1], /DROP TABLE agent_run_viewer_leases/);
  assert.match(calls[0].args[1], /generation varchar\(64\) NOT NULL/);
  assert.match(calls[0].args[1], /idx_agent_terminal_sessions_task_created/);
  assert.match(calls[0].args[1], /launch_generation integer NOT NULL/);
  assert.match(calls[0].args[1], /workspace_slug varchar/);
  assert.match(calls[0].args[1], /DELETE FROM graph_runs/);
  assert.match(
    calls[0].args[1],
    /UPDATE ticketry_launchpolicydecision[\s\S]*delivered_at IS NULL/,
  );
  assert.equal(readFileSync(product, "utf8"), "product rows");
  rmSync(fixtureRoot, { recursive: true });
});

test("a failed SQLite backup removes its partial temporary profile", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ticketry-product-snapshot-test-"));
  const source = path.join(fixtureRoot, "product");
  const temporaryRoot = path.join(fixtureRoot, "temporary");
  mkdirSync(source);
  mkdirSync(temporaryRoot);
  writeFileSync(path.join(source, "state.db"), "source state");

  assert.throws(
    () => createProductDataSnapshot({
      sourceDirectory: source,
      temporaryRoot,
      runner() {
        throw new Error("backup failed");
      },
    }),
    /could not snapshot the Ticketry product database: backup failed/,
  );
  assert.deepEqual(
    existsSync(temporaryRoot) ? [] : ["missing"],
    [],
  );
  assert.deepEqual(readdirSync(temporaryRoot), []);
  rmSync(fixtureRoot, { recursive: true });
});
