# Imperative worktree status reader has no production caller

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/agents/worktrees/internal/statusTransport.ts:20-39`.

`readWorktreeStatus` performs a network-only Apollo query. The only calls found in the repository are in `statusTransport.test.ts` and `overhaulWorkspaceCutoverAcceptance.test.tsx`. WorktreeBlock reads the same document directly through useQuery.

The extra reader and its transport test maintain a second read path that the application never exercises. Delete the reader and its now-unused client/document imports. Keep adaptWorktreeStatus, which the component and mutations use.

Move the transport assertions onto the actual WorktreeBlock read path. Update the numbered workspace cutover case instead of silently dropping its gate coverage. Preserve the adapter's absence-value test if the adapter remains.

Validation: whole-repository symbol search, frontend typecheck, and WorktreeBlock/workspace-cutover acceptance cases. This is separate from removing unused WorktreeContext in finding 003; do not count the same reader lines twice.
