# Studio scratchpad

Temporary notes for follow-up cleanup.

- `AppShell` and `TasksPane` both call `useTaskTree()`. The app shell needs the
  flattened visible rows for global keyboard navigation, but this duplicates the
  task-tree derivation used for rendering. Consider exposing the rows from one
  shared selector/provider if profiling shows it matters, while preserving
  shortcuts when focus is outside the task pane.
