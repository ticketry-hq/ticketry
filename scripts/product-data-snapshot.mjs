import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { createTemporarySqliteProfile } from "../studio/scripts/desktop-dev.mjs";
import {
  resolveProductDataDirectory,
} from "./product-identity.mjs";

const sqliteDatabases = ["state.db", "rust-core.sqlite3"];
const companionEntries = ["media", "profiles.json", "approved-executables.json"];
export {
  resolveProductDataDirectory,
  resolveProductDataDirectory as resolveEstablishedProductDataDirectory,
};

function sqliteString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function snapshotSqliteDatabase(source, destination, runner) {
  runner("sqlite3", [source, `.backup ${sqliteString(destination)}`], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function copyCompanionEntry(sourceDirectory, destinationDirectory, name) {
  const source = path.join(sourceDirectory, name);
  if (!existsSync(source)) return;
  cpSync(source, path.join(destinationDirectory, name), {
    recursive: lstatSync(source).isDirectory(),
  });
}

export function sanitizeDevelopmentDataSnapshot({
  snapshotDirectory,
  runner = execFileSync,
} = {}) {
  const database = path.join(snapshotDirectory ?? "", "state.db");
  if (!snapshotDirectory || !existsSync(database)) {
    throw new Error(`development snapshot database was not found at ${database}`);
  }
  const cleanup = [
    "PRAGMA foreign_keys = OFF",
    "BEGIN IMMEDIATE",
    "DROP TABLE agent_run_viewer_leases",
    `CREATE TABLE agent_run_viewer_leases (
       agent_run_id varchar NOT NULL PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
       viewer_id varchar(64) NOT NULL,
       transport varchar(16) NOT NULL CHECK (transport IN ('native','xterm')),
       generation varchar(64) NOT NULL,
       acquired_at datetime NOT NULL,
       expires_at datetime NOT NULL
     )`,
    "DROP INDEX IF EXISTS idx_terminal_task_created",
    `CREATE INDEX IF NOT EXISTS idx_agent_terminal_sessions_task_created
       ON agent_terminal_sessions(task_id, terminated_at, created_at DESC)`,
    "DROP TABLE launched_tasks",
    "DELETE FROM graph_runs",
    `UPDATE ticketry_launchpolicydecision
       SET delivered_at = COALESCE(delivered_at, created_at)
       WHERE delivered_at IS NULL`,
    `CREATE TABLE launched_tasks (
       task_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id) ON DELETE CASCADE,
       root_id char(32) NOT NULL REFERENCES graph_runs(root_id) ON DELETE CASCADE,
       claim_id char(32) NOT NULL UNIQUE,
       agent_run_id varchar(255) NOT NULL REFERENCES agent_runs(id),
       launch_effect_id char(32) NOT NULL UNIQUE REFERENCES runs_launch_effects(effect_id),
       launch_generation integer NOT NULL CHECK (launch_generation > 0),
       launched_at datetime NOT NULL
     )`,
    "CREATE INDEX launched_tasks_root_id_8d9455d7 ON launched_tasks(root_id)",
    "CREATE INDEX launched_tasks_agent_run_id_899 ON launched_tasks(agent_run_id)",
    "DROP TABLE worktrees",
    `CREATE TABLE worktrees (
       id varchar NOT NULL PRIMARY KEY,
       task_id varchar NOT NULL UNIQUE,
       workspace_slug varchar,
       project_id varchar,
       module_id varchar,
       ticket_seq integer,
       repo_root varchar NOT NULL,
       path varchar NOT NULL,
       branch varchar NOT NULL,
       base_branch varchar NOT NULL,
       base_commit varchar NOT NULL,
       status varchar NOT NULL,
       ephemeral boolean NOT NULL,
       created_at varchar NOT NULL,
       updated_at varchar NOT NULL
     )`,
    "COMMIT",
    "PRAGMA foreign_keys = ON",
  ].join("; ");
  runner("sqlite3", [database, cleanup], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

export function createProductDataSnapshot({
  sourceDirectory,
  temporaryRoot,
  runner = execFileSync,
} = {}) {
  if (!sourceDirectory) {
    throw new Error("the Ticketry product data directory is required");
  }
  const sourceDatabase = path.join(sourceDirectory, "state.db");
  if (!existsSync(sourceDatabase) || !lstatSync(sourceDatabase).isFile()) {
    throw new Error(`Ticketry product database was not found at ${sourceDatabase}`);
  }

  const destinationDirectory = createTemporarySqliteProfile({ temporaryRoot });
  try {
    mkdirSync(destinationDirectory, { recursive: true });
    for (const name of sqliteDatabases) {
      const source = path.join(sourceDirectory, name);
      if (!existsSync(source)) continue;
      snapshotSqliteDatabase(source, path.join(destinationDirectory, name), runner);
    }
    for (const name of companionEntries) {
      copyCompanionEntry(sourceDirectory, destinationDirectory, name);
    }
    return destinationDirectory;
  } catch (error) {
    rmSync(destinationDirectory, { recursive: true, force: true });
    throw new Error(`could not snapshot the Ticketry product database: ${error.message}`);
  }
}
