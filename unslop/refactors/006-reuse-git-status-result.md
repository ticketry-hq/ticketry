# One changes read runs the same Git status command twice

Priority: P2. Effort: Small. Category: Performance.

## Evidence

- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs), line 59, `super::command_git::facts`.
- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/command_git.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/command_git.rs), line 29, `["status", "--porcelain=v1", "-z", "--untracked-files=all"]`.
- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/git.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/git.rs), line 56, `["status", "--porcelain=v1", "-z", "--untracked-files=all"]`.

## Why change it

`changes()` calls `command_git::facts()` and then `git::cumulative()`. Both execute the identical porcelain status command in the same checkout during one repository-lock acquisition. One uses it to calculate dirty state; the other merges paths into the changed-file list. This duplicates process startup and working-tree scanning on every changes refresh.

## Smallest useful refactor

Read status once per changes request and pass the validated result to both calculations. Keep standalone command callers able to acquire their own status. Preserve the existing byte, truncation, and conflict handling instead of introducing a persistent Git cache.

## Validation

Use the Git command fixture to assert one status invocation per changes read. Compare dirty flags and changed paths for clean, modified, untracked, renamed, conflicted, and truncated output. Measure a large checkout before claiming a latency improvement.
