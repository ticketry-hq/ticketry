---
status: accepted
---

# A generic right dock hosts the Worktrees view

Ship history (CODING-999) needs a home tied to worktrees, and ADR 0012 warned
against sprouting single-purpose persistent panels. Instead of a one-off
worktrees panel, Studio gets a generic right dock in the VS Code/Zed style: a
shell with a view registry and status-bar toggles, showing one registered view
at a time. The Worktrees view is its first occupant, listing the module base
checkout as a permanent first row followed by live task worktrees, each row
carrying its ship history.

## Considered options

A single-purpose Worktrees panel was cheaper now but would either be rebuilt or
generalized under pressure when the second view arrives. Putting ship history
in the Changes tab or the Details pane kept it off the shell, but the user
wants worktrees to be a workspace-level surface, not a per-task one.

## Consequences

The dock is the third persistent shell region after the workspace tabs and the
terminal panel; layout must resolve contention with the terminal panel rather
than letting them stack. The Worktrees view shows history only for checkouts
that still exist — the durable per-task trace is the task ship line on the
Details pane, and records for discarded worktrees stay in the database awaiting
a future module-history view.
