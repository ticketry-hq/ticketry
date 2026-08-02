# T82 — RHS detail panel load time

## Diagnosis

The panel is not slow because fetching is slow. It is slow because the client
throws away data it already holds and re-fetches it.

`GET /modules/{id}/work-items` (`backend/worktracker/api/work_items.py:152`)
returns every descendant of the module, flat, as a complete `WorkItemOut`. On
module load Studio therefore already has the faithful record for every task the
user is about to cycle through — and its children. It then:

- converts each to `TaskSummary` (`studio/src/features/studio/lib/api.ts:137`),
  discarding `created_at`, `is_archived`, `lifecycle_state`,
  `lifecycle_transitions`, `blocked_by_ids`, `blocks_ids`, and `labels[].color`,
  and fabricating `{name: "No state"}` where the server sent `null`
  (`lib/api.ts:145`);
- explicitly nulls the detail it holds on selection
  (`studio/src/features/studio/stores/tasksStore.ts:636`);
- re-fetches the same record twice, from two stores that do not know about each
  other (`lib/api.ts:302` and
  `studio/src/features/work-items/issue-detail/internal/issueStore.ts:186`);
- re-fetches the children, which are also already in memory
  (`issueStore.ts:209`);
- blanks to "Loading issue…" while it waits
  (`studio/src/features/work-items/issue-detail/IssueDetail.tsx:76`).

A settled selection costs five HTTP requests. For any task with a remembered
document or terminal, the panel is additionally hidden behind "Restoring
workspace…" (`WorkspacePane.tsx:1143,1151`) until the two most expensive
endpoints on the path resolve — `/api/documents` performs a filesystem scan
(`backend/apps/documents/service.py:78-89`) and `/api/terminals` performs full
tmux reconciliation (`backend/apps/terminals/api.py:219-229`).

Underneath the symptom is a structural defect. Work-item records live in four
stores across two feature lineages, in two incompatible shapes:

| Store | Field | Shape |
| --- | --- | --- |
| `tasksStore` | `tasks[]` / `subtasks{}` | `TaskSummary` (lossy) |
| `tasksStore` | `details.task` | `TaskSummary` (lossy) |
| `issueStore` | `open.task`, `children[]` | `WorkItem` |
| `backlogStore` | `items[]` | `WorkItem` |
| `drawerWorkspaceStore` | `byIssueKey[*].task` | `WorkItem` |

One task exists three to four times. State and parent are mutable through two
independent code paths (`tasksStore.ts:688,715` and `issueStore.ts:274`), each
updating a different subset of copies; the status feed reconciles two of the
four (`statusFeed.ts:96,256`); `drawerWorkspaceStore` has no reconciliation path
at all. `CONTEXT-MAP.md:29-31` already records this as a standing translation
risk.

## Design

### One owner

`issueStore` becomes the single owner of work-item records, keyed by id:
`byId: Record<id, WorkItem>`, `openId`, `childIds`, attachments by id, and a
`key → id` index for `TIC-82`-style lookups. The module load writes into `byId`.
`tasksStore`, `backlogStore`, and `drawerWorkspaceStore` hold IDs only.

`TaskSummary` and `normalizeTask` are deleted. The synthetic `"No state"` is
deleted; callers handle `state: null` as the server sends it.

`issueStore` keeps its current name and location. Accepted cost: it lives under
`issue-detail/internal/` while being imported by three stores outside it.

### Mutations

State, parent, and create-child consolidate onto `issueStore`
(`patchField` / `addSubtask`), which already has optimistic patching and
per-field `saving` flags. The status-feed revision guards
(`seenStateRevisions`, `pendingStateDeltas`) move with the records they protect.

`tasksStore` keeps rank and reorder. The line is: changes the *record* →
`issueStore`; changes the *ordering* → `tasksStore`.

### Runtime behaviour

Paint is never gated. A selection renders the full panel from `byId` in the same
frame. Both 150 ms debounces come off the render path
(`TasksPane.tsx:215`, `DetailsTab.tsx:32-41`).

One background `GET /work-items/{id}` follows, for attachments and for edits
made elsewhere — the status feed publishes state moves only, so dropping this
would regress freshness (`CONTEXT-MAP.md:31`). It carries a 150 ms debounce and
an abort-on-change, **on the refresh only**: delaying or cancelling it is
invisible because the panel is already rendered.

`"Restoring workspace…"` is deleted. Details paints immediately; a remembered
document or terminal tab activates behind it when its fetch resolves. The
tab-discovery fetches stay eager — each document and terminal *is* a tab
(`WorkspacePane.tsx:975,990`), so deferring them would mean the tabs never
appear — but they are debounced and aborted alongside the detail refresh.

A genuine miss — deep link, standalone drawer, cross-module — falls back to
today's loading state. That path is rare and a loading state there is honest.

### Result

Cycling within a loaded module: **0 requests to render**, one debounced
background refresh, no blank frame. Today: 5 requests and a ≥150 ms floor before
anything is visible.

## Verification

No instrumentation is being added, so the tests are the proof. Vitest +
testing-library, asserting the invariants that define the design:

- selecting a loaded task renders synchronously, with no loading state;
- exactly one `GET /work-items/{id}` per settled selection, not two;
- a late response for task A cannot paint while B is selected;
- a task with a remembered terminal shows Details, not "Restoring workspace…";
- a genuine cache miss falls back to the loading state.

## Out of scope

Deferred to their own tickets:

- **Server-state library.** TanStack Query, retention across navigation,
  staleness rules, prefetch, eviction. Considered and rejected for this story —
  it would not have normalized the shapes, so the disagreement bug would have
  survived. See `studio/docs/adr/0006-one-keyed-work-item-store.md`.
- **Backend list payload.** `WorkItemOut` ships `description`,
  `description_html`, and `description_stripped` on every list item
  (`schemas.py:131-133`) — 787 KB for the 316-item module. Lists need one.
- **Backend N+1.** `schemas.py:162,177` resolve assignees and labels per item
  with no `prefetch_related` — 632 wasted queries on that same module, against a
  database with 0 assignee links and 14 label links total.
- **Vocabulary.** `Task`, `Issue`, and `WorkItem` still name one aggregate.
  Recorded in `studio/CONTEXT.md`; the rename is not attempted here.
