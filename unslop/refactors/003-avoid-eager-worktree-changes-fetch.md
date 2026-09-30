# Selecting a task fetches changes before the changes tab needs them

Priority: P2. Effort: Small. Category: Performance.

## Evidence

- [studio/src/app/shell/ticket-workspace/selected-ticket/internal/useTaskWorktreeChangesTabLifecycle.ts](../../studio/src/app/shell/ticket-workspace/selected-ticket/internal/useTaskWorktreeChangesTabLifecycle.ts), line 25, `query: WorktreeChangesDocument`.
- [studio/src/features/agents/worktrees/changes/TaskWorktreeChanges.tsx](../../studio/src/features/agents/worktrees/changes/TaskWorktreeChanges.tsx), line 31, `fetchPolicy: "network-only"`.
- [studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs](../../studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/worktree/changes/service.rs), line 40, `pub async fn changes(`.

## Why change it

The tab-lifecycle hook fetches full worktree changes as soon as availability becomes `worktree`, even while details or a terminal is active. When the user later opens Changes, its component requests the same data with `network-only`. Once the eager request has finished, these are separate reads. Each backend read runs several Git commands and can call GitHub. The lifecycle hook only needs availability to decide whether to show the tab.

## Smallest useful refactor

Remove the eager changes query from the lifecycle hook and fetch on activation. If prefetching is an intentional interaction requirement, make the tab consume that result and define when it becomes stale.

## Validation

Count WorktreeChanges requests in the worktree acceptance harness. Selecting a task without opening Changes should make zero full changes requests; opening Changes should make one. Preserve external-change and post-mutation refresh behavior.
