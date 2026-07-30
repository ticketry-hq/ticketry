# Ticketry Context Map

## Contexts

- **Work Management** owns workspaces, projects, work items, types, workflows,
  launch bindings, and the durable planning database.
- **Agent Execution** owns dependency-graph runs, launch readiness, retry
  attempts, and durable agent-run lifecycle.
- **Workspace Runtime** owns tmux-backed terminal sessions, document access, and
  task worktrees.
- **Studio Experience** owns the human-facing workspace, navigation, local view
  projections, editing interactions, and desktop API client.
- **Desktop Runtime** owns the Tauri/webview boundary, supervised backend
  sidecar, native terminal renderer, and application lifecycle.

## Relationships

| Upstream | Relationship | Downstream |
| --- | --- | --- |
| Studio Experience | reads and mutates work through HTTP; reconciles selected changes from the status feed | Work Management |
| Agent Execution | reads dependency and launch policy; writes execution outcomes | Work Management |
| Agent Execution | creates and observes agent sessions | Workspace Runtime |
| Studio Experience | opens terminals, documents, and worktrees through sidecar contracts | Workspace Runtime |
| Desktop Runtime | loads the Studio webview and supervises the Python sidecar | Studio Experience |
| Desktop Runtime | embeds the native terminal renderer while tmux retains durable sessions | Workspace Runtime |

## Translation risks

- Backend work items are authoritative, but Studio keeps several projections:
  backlog/task collections and separate issue-detail records.
- The current status feed publishes committed workflow-state moves, not general
  work-item revisions or deletion tombstones. A detail page can therefore remain
  stale after non-state edits until it explicitly refetches.
- Terminal lifecycle state, WebSocket transport state, and tmux liveness are
  separate axes and must not be collapsed into one status.
