// Real-git fixtures shared by script tests that need actual repositories and
// linked worktrees rather than mocks.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function createRepository(name) {
  const parent = mkdtempSync(path.join(tmpdir(), `muxed-desktop-dev-${name}-`));
  const repository = path.join(parent, name);
  mkdirSync(repository);
  git(repository, "init", "--quiet");
  git(repository, "config", "user.email", "desktop-dev@example.test");
  git(repository, "config", "user.name", "Desktop Dev Test");
  execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", "fixture"], {
    cwd: repository,
  });
  return { parent, repository };
}

export function addLinkedWorktree(repository, destination, branch) {
  git(repository, "worktree", "add", "--quiet", "-b", branch, destination);
  return destination;
}
