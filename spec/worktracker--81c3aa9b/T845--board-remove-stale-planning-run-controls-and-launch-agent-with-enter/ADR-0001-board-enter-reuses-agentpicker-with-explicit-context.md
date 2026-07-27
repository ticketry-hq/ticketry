# ADR-0001: Board Enter reuses AgentPicker via an explicit-context payload

**Status:** Accepted (refinement, 2026-07-08)
**Ticket:** CODIN-845

## Context

The ticket asks Board Enter to launch a task-bound agent "matching the /coding
task-list flow," and the HLD marks `AgentPicker.tsx` as a **read-only seam**
(reuse, only touch "if explicit task context is required").

Inspection shows explicit task context *is* required. Two worlds do not meet:

- **/coding** owns `AgentPicker` (`studio/src/coding/modals/AgentPicker.tsx`).
  Its `open` (task-bound) branch reads `selectedTaskId` / `selectedProjectId` /
  `selectedModuleId` from the **/coding** `useTasksStore`, and derives
  `ticketSeq` via `tasks.find(t => t.id === selectedTaskId)`. There is **no**
  payload field carrying a task; `open` is entirely store-driven.
- **The Board** (`studio/src/workitems`) is a worktracker-studio surface. Its
  selection is `useSelectionStore`, its project is
  `useStudioStore.selectedProjectId`, and a Board `WorkItem` carries
  `id`/`key`/`sequence_id` but **no `moduleId`**. The /coding `tasksStore` is
  never populated here.

Precedent confirms the split: the Backlog already opens `agent-picker`, but only
in `plan`/`instant` modes with **explicit** `projectId`/`moduleId` payloads
(the create-flow, `workitems/backlog/terminalCreate.ts`). Nothing launches a
task-bound `open` run from a studio surface today. The drawer's own `+ Agent`
sidesteps AgentPicker entirely: it resolves a full `launchContext`
(project/module/ticketSeq/profile) via the async `resolveIssueWorkspaceContext`
and calls `openSession` directly.

## Decision

Reuse the AgentPicker modal (shared `ModalHost` is already mounted app-wide in
`StudioApp`), and **extend its `open` / `open-with-prompt` payload to accept
explicit task context**: `taskId`, `ticketSeq`, plus `projectId` / `moduleId`
(the last two already exist on the payload). AgentPicker's task-bound branch
prefers `payload.taskId` / `payload.ticketSeq` over the /coding store; the
`/coding` keymap keeps working because omitting them falls back to the store.

Board Enter flow:

1. On Enter (focused card only — `selectionStore` untouched), resolve context
   via `resolveIssueWorkspaceContext(item.key)` + config load.
2. If the profile is **ready**, push
   `agent-picker { mode:"open", taskId, ticketSeq, projectId, moduleId }`.
3. On resolve failure **or** profile-not-ready, surface a toast (`toastStore`
   is already app-mounted via `ToastHost`) and do not open. Ignore repeat
   Enters while a resolve is in flight.
4. `commit(agent)` calls `openSession` with the explicit context.

This **reverses the HLD's "read-only AgentPicker" claim** — AgentPicker is now a
`modified` file, not `read-only`.

## Keyboard semantics

- **Enter** → AgentPicker (`open`) for the focused card.
- **Shift+Enter** → prompt-first (`open-with-prompt`), also with explicit
  context. This is the widest blast radius: `startOpenWithPromptFlow` is
  store-driven and chains a context-free `{mode:"open-with-prompt"}` payload
  through the module-folder gate + PromptInput, so the Board needs its own flow
  that seeds explicit context, and **PromptInput must forward
  taskId/ticketSeq/projectId/moduleId when chaining to agent-picker**.
- **Space** → keeps the old behavior: navigate to `/issues/:key` (drawer).
  Split from Enter (today `BoardCard` treats them identically).
- **Escape / click / drag / multi-select** → unchanged.

## Alternatives rejected

- **Bridge into /coding `tasksStore`** (write `selectedTaskId` + inject the item
  into `tasks[]` so `ticketSeq` resolves, then use the unchanged `open` path):
  mutates cross-world store state as a side effect of a keypress; the injected
  item is a foreign shape and leaks Board state into /coding. Rejected.
- **Drawer-style, no picker** (resolve `launchContext`, show a tiny agent menu,
  `openSession` directly): proven and avoids touching AgentPicker, but abandons
  the "/coding parity" the ticket asks for and duplicates a launcher. Rejected
  in favor of one shared picker.

## Consequences

- AgentPicker gains 2 optional payload fields; `/coding` callers are unaffected
  (fallback to store when absent). A single canonical task-bound launch surface.
- Board Enter is **async** before the modal opens (network resolve). Accepted:
  resolution is fast; a toast covers the slow/failed/not-ready paths.
- FE planning-run client (`postPlanningRun`, `releasePlanningRun`,
  `PlanningPhase`) becomes dead after drawer cleanup and is **removed**;
  backend endpoints are untouched (out-of-scope guard).
- Reversal path: if AgentPicker reuse proves awkward, the drawer-style menu is
  the fallback with no store changes to unwind.
