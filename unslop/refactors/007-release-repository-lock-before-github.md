# GitHub reads hold the lock for every worktree in a repository

Priority: P1. Effort: Medium. Category: Performance.

## Evidence

- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs), line 52, `let _guard = self.status.repository_locks().acquire`.
- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs), line 65, `.mapped_pull_request_status`.
- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/github.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/github.rs), line 17, `const READ_TIMEOUT`.
- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/status/repository_locks.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/status/repository_locks.rs), line 42, `pub async fn acquire`.

## Why change it

`changes()` retains its repository guard while fetching pull-request status and reconciling lifecycle state. `GithubPort::pull_request` performs a remote PR read and, for an open PR, a required-checks read. Each has a 30-second timeout. All checkouts sharing the repository lock wait behind this network work. A slow provider can therefore delay unrelated local status or worktree operations in the same repository.

## Smallest useful refactor

Capture the checkout and PR identities under the lock, release it for remote reads, then reacquire and verify the worktree row, head, and PR identity before applying lifecycle decisions. Retry or discard observations that no longer match. Keep local Git mutations serialized.

## Validation

Hold a fake GitHub response pending and verify another checkout in the same repository can perform a local read. Change or remove the worktree while the response is pending and verify stale provider data cannot change lifecycle state. Lock narrowing requires these concurrency checks.
