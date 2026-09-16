# Worktree callers build a context that every transport discards

Tag: `delete`. Confidence: high.

Locations:

- `studio/src/features/agents/worktrees/internal/types.ts:26-32`
- `studio/src/features/agents/worktrees/internal/createTransport.ts:26-31`
- `studio/src/features/agents/worktrees/internal/discardTransport.ts:24-29`
- `studio/src/features/agents/worktrees/internal/statusTransport.ts:20-26`
- `studio/src/features/agents/worktrees/WorktreeBlock.tsx:68`

WorktreeContext carries parent, module, project, sequence, and task-name fields. All three transports immediately discard it with `void ctx`. WorktreeBlock still constructs it, callers pass it, and the feature barrel exports it. The actual requests use task identity and, for writes, operation identity.

Delete the context type, export, object construction, and unused parameters. Update callers and mock expectations. The status reader also discards its AbortSignal; remove that parameter if cancellation is not part of the intended contract, or implement cancellation separately if it is required.

Replace the transport headers' retired-host-route history with a short description of the current GraphQL request. These files contain no legacy host branch.

Validation: typecheck and run worktree transport and UI acceptance cases. Assert the same task and operation variables still reach GraphQL.
