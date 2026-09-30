import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MODULE_FILE = "changes-module.txt";
const TASK_FILE = "changes-task.txt";
const FILE_BYTES = 64 * 1024;

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function compactId(value) {
  return value.replaceAll("-", "");
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function checkoutBytes(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git")
    .reduce((total, entry) => {
      const entryPath = path.join(directory, entry.name);
      return total + (entry.isDirectory() ? checkoutBytes(entryPath) : statSync(entryPath).size);
    }, 0);
}

/**
 * Add deterministic Git input to the disposable profiling repository.
 *
 * Worktree rows have no public fixture mutation. The profiling profile is
 * offline and disposable, so this helper creates the real Git worktree and
 * writes only its derived index row after the adapter has closed state.db.
 */
export function prepareChangesFixture({ fixture, dataDirectory }) {
  const task = fixture.detailWorkItems[0];
  if (!task?.id || !task.sequenceId) {
    throw new Error("the Changes fixture needs one seeded work item identity");
  }

  const repo = fixture.moduleFolder;
  const baseCommit = run("git", ["-C", repo, "rev-parse", "HEAD"]);
  const taskCheckout = path.join(
    os.tmpdir(),
    `ticketry-performance-changes-${randomUUID()}`,
  );
  const branch = `perf/changes-loading-${randomUUID().slice(0, 8)}`;
  run("git", ["-C", repo, "worktree", "add", "-b", branch, taskCheckout, baseCommit]);

  writeFileSync(path.join(taskCheckout, TASK_FILE), "t".repeat(FILE_BYTES));
  writeFileSync(path.join(repo, MODULE_FILE), "m".repeat(FILE_BYTES));
  mkdirSync(path.join(taskCheckout, "nested"), { recursive: true });
  writeFileSync(path.join(taskCheckout, "nested", "small-change.txt"), "task change\n");

  const now = new Date().toISOString();
  const values = [
    compactId(randomUUID()),
    compactId(task.id),
    "changes-loading",
    compactId(fixture.projectId),
    compactId(fixture.navigationModules[0].id),
    task.sequenceId,
    repo,
    taskCheckout,
    branch,
    "main",
    baseCommit,
    "active",
    0,
    now,
    now,
  ];
  const statement = `INSERT INTO worktrees (`
    + "id, task_id, workspace_slug, project_id, module_id, ticket_seq, "
    + "repo_root, path, branch, base_branch, base_commit, status, ephemeral, "
    + "created_at, updated_at, pull_request_url"
    + `) VALUES (${values.map(sql).join(", ")}, NULL);`;
  run("sqlite3", [path.join(dataDirectory, "state.db"), statement]);

  return {
    moduleFile: MODULE_FILE,
    taskFile: TASK_FILE,
    fileBytes: FILE_BYTES,
    changedFileCounts: { module: 1, task: 2 },
    checkoutBytes: {
      module: checkoutBytes(repo),
      task: checkoutBytes(taskCheckout),
    },
    worktreeCount: 2,
    task: { id: task.id, key: task.key, name: task.name },
    taskLabel: `CDN-${task.sequenceId} ${task.name}`,
    taskCheckout,
    branch,
    baseCommit,
    pullRequestMapping: "none",
    networkCondition: "no GitHub request expected because the fixture has no PR URL",
  };
}

export function removeChangesFixture(fixture) {
  if (!fixture?.taskCheckout || !fixture?.moduleFolder) return;
  try {
    run("git", [
      "-C",
      fixture.moduleFolder,
      "worktree",
      "remove",
      "--force",
      fixture.taskCheckout,
    ]);
  } catch {
    rmSync(fixture.taskCheckout, { recursive: true, force: true });
    try {
      run("git", ["-C", fixture.moduleFolder, "worktree", "prune"]);
    } catch {
      // The disposable repository is removed by its existing owner later.
    }
  }
}
