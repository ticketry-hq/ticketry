# One holding per thing — decision record

**Date:** 2026-08-06
**Origin:** CODING-145, grilled before entering Spec
**Method used:** [`../decision-making-method.md`](../decision-making-method.md)
**Supersedes:** sections 3.1–3.3 of
[`2026-08-04-frontend-state-and-api-contract.md`](2026-08-04-frontend-state-and-api-contract.md)
(the Redux Toolkit decision and its enforcement design). Everything else in that
record still stands.

This is the reasoning record, not the plan. The plan is the spec on CODING-145.
Read this before re-opening any question about where Studio holds state — it
records the paths already walked and why each was left.

---

## 1. Why this record exists

Two days after the Redux Toolkit rebuild was decided, CODING-145 was grilled
before implementation. Three things came out of it that the earlier record could
not have known, because they were facts about the code rather than judgements
about design:

1. The ordering guarantee the Redux design rested on **does not exist** in the
   backend today, and no Story owned adding it.
2. The measured blast radius was **a third** of what the earlier record assumed.
3. The rule that gave the Redux design its shape — the request layer may not
   hold records — is what made both candidate libraries' optimistic machinery
   unusable, and it was costing more than it bought.

The reversal was not a change of taste. It was one structural argument, stated
in section 3.

---

## 2. The fact that forced it

`backend/worktracker/CONTEXT.md` defines the **work-item change revision** as a
project-monotonic counter stamped "whenever a committed change to it must reach
live clients — a field edit, a relationship change, a reorder, a creation, or a
deletion, not only a workflow-state transition", and tells the reader to avoid
the term "state-only revision".

`backend/worktracker/models/issue.py:110-114` does the opposite:

```python
if update_fields is not None and not {"state", "state_id"}.intersection(update_fields):
    return super().save(*args, **kwargs)
```

The counter advances only when `state_id` changes. A rename advances nothing.

And `spec-backend.md:92` asked for revision semantics **unchanged**.

So the glossary described the semantics the frontend needed, the code did not
implement them, and the backend spec froze the code as it was. Three artefacts,
three positions, and the gap owned by nobody. Every design considered here fails
without the broadening: with a request-keyed cache a rename publishes no frame;
with per-item entries a rename publishes no frame either. It is the load-bearing
change, and it is now CODING-144's.

A second-order consequence: with push-only freshness a missed bump never heals.
So the bump needs its own backend test — a write path that changes a published
field and does not advance the counter must fail.

---

## 3. The argument that reversed ADR-0009

A **work-item change frame** carries identity and revision only. The client
learns *that* an item changed and reads the item to learn *what* changed.

For a cache keyed by request shape, applying that frame means knowing every
entry that holds the item, and patching or invalidating each. That is the
invalidation fan-out ADR-0009 cited as its reason for choosing one Redux store.
The reasoning was correct. The conclusion did not follow.

The fan-out is a property of **keying by request shape**, not of caching. Key
each entry by the item's own id and the frame becomes
`invalidateQueries(['workItem', id])` — one entry, one row repainted, no
knowledge of who holds what.

Once that is true, ADR-0009's machinery has no remaining purpose. Its read seam,
its write seam and its "the cache holds no records" test all existed to route
around a cache it had forbidden to hold data. Remove the prohibition and all
three disappear.

---

## 4. The path walked, in order

Recorded because each step was reasonable and a future reader will propose them
again.

**4.1 Keep Redux, own the write seam.** Records in entity slices, RTK Query for
request lifecycle only. Rejected once it was clear that *the rule*, not the
library, was what made `updateQueryData`/`patchResult.undo` and
`onMutate`/`onError` unusable — both libraries implement optimistic writes
against their own cache. Under this rule you hand-roll the seam in either
library, so the rule was the thing to question.

**4.2 Drop the request library entirely** — `createAsyncThunk` plus
`createEntityAdapter`. Genuinely smaller. Overtaken by 4.3.

**4.3 Pessimistic writes.** A plain thunk: request, then write the authoritative
record; nothing paints until the server confirms. The sidecar is local, so the
wait is milliseconds, and it deletes the baseline, the revert and the rollback
rules outright. Declined — the latency is felt, and it was not worth the
behavioural regression.

**4.4 The orthodox split.** React Query owns server state, client stores own
client state, lists are derivations. This is what was agreed mid-session on
2026-08-04 and then declined. Taken this time, for the section 3 argument rather
than the line count.

**4.5 No global client store.** Selection, expansion and focus in context and
`useReducer`. Declined after costing: it rewrites four files that are already
correct, re-implements `uiStore`'s versioned localStorage, loses the enforcement
walk's single target, and gives up selector-level subscription on the hot path —
`ADR-0002` also records a single focus store.

**4.6 One flat module entry holding every record.** One request, no seeding, no
skeleton gap. Replaced by 4.8 because a frame then invalidates the whole module
and a structure change refetches every record.

**4.7 Nested tree from the serializer.** Rejected: it gives each `WorkItem` a
`children: WorkItem[]`, which is an entity bundled with a collection, against
CODING-144's read contract; and every optimistic move must rebuild an ancestor
path immutably instead of writing one `rank`.

**4.8 Ids tree plus per-item entries, seeded with `setQueryData`.** Correct
shape, and the frame becomes exact. But the seeding loop is a one-reply-many-keys
fan-out — structurally the same shape as the defect being removed — needing a
standing exception to the invariant. Exceptions like that decayed twice here.

**4.9 Ids tree plus per-item entries, filled by a batching `queryFn`.** Taken.
See 5.3.

---

## 5. Decisions

### 5.1 One holding per thing

Not "no server data in stores". Request-carried records live in a query entry
keyed by their own id. Stream-carried values live in a store, which is then not a
copy but the only holding. What is prohibited is two holdings of the same
*field*.

This distinction is what makes agent run liveness legitimate in a store while
`TaskSummary` is not.

### 5.2 Per-work-item entries; membership as ids

`['tree', moduleId]` returns root ids, a parent-to-children map, and order.
`['workItem', id]` holds the record. Sections and rank order are selectors. A row
carries an id and structural facts — depth, parent, expandability, expansion —
and never a field of the record it points at, so one record change repaints one
row and no memoised row can hold a stale name.

The rendered view exists only as what is on screen. Intermediate row objects are
discarded every render, which is why `taskTreeCache` — which kept the committed
view — is deleted.

### 5.3 A batching `queryFn`, not a seeded cache

Two hundred rows mount two hundred queries. Their `queryFn` calls collect in a
ten-millisecond window and leave as one `GET /work-items?ids=…`, chunked at one
hundred ids for URL length; a failed batch rejects each id's promise separately.

The property this buys over 4.8 is not fewer requests — both are one — but that
**no code writes into a cache key it does not own**. Each entry is filled by its
own query resolving. There is no fan-out to permit, so no exception to police.

### 5.4 Freshness is push

`staleTime` is five minutes. Nothing refetches on window focus. A frame
invalidates one entry; an invalidated entry with no mounted subscriber costs
nothing until it is shown. The status feed's cursor replay
(`apps/runs/consumers.py:29-57`, already built) closes gaps on reconnect.

`staleTime: Infinity` was considered and rejected. It was only ever needed to
prevent a two-hundred-query stampede, and batching removes the stampede.

### 5.5 Optimistic writes are the library's

`useMutation` applies in `onMutate`, keeps the previous value in its context, and
restores in `onError`. The context is where the baseline lives — outside the
store, so the enforcement walk stays strict. A reorder writes
`{before_id, after_id}`; the endpoint is already id-shaped.

### 5.6 Client stores are kept, not ported

`uiStore`, `selectionStore`, `dialogStore`, `toastStore` already hold ids and
view state only. `selectionStore` is the precedent for the whole rule: it holds
ids, and `range()` receives `orderedIds` from the view at call time rather than
mirroring the rendered order.

A `createClientStore` factory registers each store so the enforcement walk covers
every one, including any added later. Forgetting to cover a new store is this
codebase's actual failure mode.

### 5.7 Enforcement

ADR-0009 was right that the enforcement is the decision that matters. It
survives with a smaller surface: a DOM-level rename regression test referencing
no store or cache; a test that no work-item id appears in two query entries and
no run field appears in both a query entry and the status store; a registry walk
after a rename; and two lint rules — no record types in a client store file, and
no `create` from zustand outside the factory.

---

## 6. The task workspace

### 6.1 A terminal tab is a run

`AgentTerminalSession.agent_run` is a `OneToOneField` with `primary_key=True`, so
a run has at most one tmux session and the session's key *is* the run id.
`tmux/_core.py:76-79` derives the name as `pt-{run_id}`, so a run has one tmux
identity for its whole life and a reattach returns the same session rather than
making another.

A work item has many runs. A run has one terminal. What is inside the terminal is
its tmux session.

### 6.2 The run owns its own fields

`taskId`, `moduleId`, `scope` and liveness belong to the run, because a run with
no terminal still has all of them and must still be counted in its work item's
subtree lifecycle chicklets. They come off anything terminal-shaped.
`terminated_at` comes off the client read for the same reason, which leaves the
session read carrying only immutable fields — so it can never be stale, and is
invalidated when a run starts rather than when one ends.

### 6.3 Liveness is pushed, and only pushed

`statusFeed.ts:48-64` shows run frames carry values — `frame.runs` on a snapshot,
`frame.run` on a lifecycle change — unlike work-item frames. So the status store
is the run's one holding for `state` and `updatedAt`. `supersedes()` is its one
ordering rule, legitimately distinct from the work-item revision because a run
has no revision; its equal-timestamp tie-break exists so a late mid-turn frame
cannot revive a dead session.

### 6.4 Documents keep their own machinery

Registry by work item; content at `staleTime: 0`, re-read whenever a tab opens,
because an agent or the watcher can rewrite the bytes at any moment and a cached
copy cannot be proved current. The revision digest, stale-save conflict,
external-change banner and watcher are untouched.

### 6.5 The tab set is derived, not stored

Terminal tabs are the runs with a live session, minus a client set of dismissed
ids, ordered by start time. `workspaceTabsStore.byTaskId` — a stored list of the
same thing — is deleted.

Deriving is not a change of behaviour. `sessionStore.ts:725` already carries the
comment "re-fetch of the server's still-live list cannot resurrect the tab", and
`addDismissedRun` already exists, which means the tab set is *already* seeded
from the server's live list and already needs the dismissed set to stay closed.
The stored list only shadowed it. The dismissed set is load-bearing and survives;
without it, closing a tab is undone by the next fetch.

### 6.6 One client store

Seven stores back the task workspace and the panes around it. They collapse into
one, of about twenty-three fields.

The `createClientStore` registry and its lint rule, proposed earlier in this
session, are withdrawn. They existed only to make many stores walkable; one store
is walkable by definition, and a slice added years from now is covered without
anyone remembering to register it. This also reverses the earlier advice not to
port `uiStore`, `selectionStore`, `dialogStore` and `toastStore` — that advice was
costed against a registry, and against one store the port buys the guarantee
outright.

Two things stay outside it. **Live objects** — xterm instances, sockets, the
viewer lease, the foreground pointer — are things with a lifecycle rather than
values, and a store holding them cannot be serialised, which the walk requires.
**The run projection** stays beside it so the walk asserts one unconditional
sentence: nothing in the client store came from the server. A conditional
invariant — "no server value except in this slice" — is the kind that decayed
twice here.

### 6.7 The client store, field by field

```ts
interface ClientState {
  // navigation & focus
  focusedPane: FocusedPane
  editViewZone: EditViewZone
  editViewBodyEngaged: boolean
  navigationModality: 'keyboard' | 'pointer'
  projectsCursorId: ProjectId | null
  modulesCursorId: ModuleId | null

  // layout (persisted)
  sidebarVisible: boolean
  panelLayout: number[] | null

  // keymap
  modalStack: ModalDescriptor[]
  bindingsStack: KeyBinding[][]

  // tree view (persisted)
  expandedIdsByModule: Record<ModuleId, WorkItemId[]>
  collapsedStateIds: Set<StateId>

  // selection & search
  selection: { surface: Surface | null; ids: Set<WorkItemId>; anchorId: WorkItemId | null }
  storySearchQuery: string

  // task workspace — entries exist only while a workspace is open
  activeTabKindByWorkItem: Record<WorkItemId, TabKind>
  activeRunByWorkItem:     Record<WorkItemId, RunId>
  activeDocByWorkItem:     Record<WorkItemId, DocId>
  closedDocIds:      Set<DocId>
  dismissedRunIds:   Set<RunId>
  openOverlayDocIds: Set<DocId>

  // transient input
  dirtyDocBuffers: Record<DocId, string>
  dialogs: DialogDescriptor[]
  toasts: Toast[]
}
```

Every value is an id, a boolean, a number, a stack of things the user did, or
text the user typed.

**Fields that changed shape, and why:**

- `expandedTaskIds` + `expandedModuleId` → `expandedIdsByModule`. The pair existed
  only because memory held one module's set while storage held a map of all of
  them, so a field was needed to record whose set was loaded. Matching the shapes
  deletes both the field and `hydrateExpandedForModule()`. And "ancestors of the
  selected work item are expanded" becomes a rule computed at read rather than
  ids written into the stored set, so the set holds only what the user did.
- `collapsedStateNames` → `collapsedStateIds`. The name key was deliberate — it
  made a collapse follow the concept across projects — but it put a server string
  in a store and needed `renameCollapsedState()` and `workflowStateRemovalSync`
  to keep it in step. With the Projects surface gated off there is one state row
  per name, so behaviour is identical today and both mechanisms are deleted.
- `projectsCursor` / `modulesCursor` → ids. These are the sidebar's keyboard
  highlight, not the selection. As indices into a server-ordered list they move
  silently onto a different row when an agent creates or deletes a module through
  MCP, and activate then opens something the user was not looking at.
- `activeBindings` deleted — it is `bindingsStack.at(-1)`.
- `closedDocIdsByWorkItem` / `dismissedRunsByWorkItem` lose their outer key. A
  `DocId` and a `RunId` are already unique, so keying them by work item stored the
  same fact twice and let the two disagree.
- `overlayOpenByDoc: Record<DocId, boolean>` → a set. A boolean map defaulting to
  false is a set.
- `focusRequest` + `focusSequence` deleted. This was an event modelled as state —
  the sequence number existed only to make an unchanged value re-fire an effect.
  Focusing a terminal is an operation on a live object, and the live object is in
  the registry, so a terminal registers `focus()` beside its xterm instance and
  the keymap calls it.
- `chatByDoc` deleted with the feature; see 6.9.

**Intent versus validity.** The three `active*ByWorkItem` maps are not redundant —
holding the active run and the active document separately is what lets a user
switch to Details and back and land on the same terminal. But they permit
combinations that do not exist, such as an active tab kind of `terminal` pointing
at a dismissed run, which `SelectedTicketContent.tsx:642` already patches at the
render site. The rule: **the store holds the user's last intent; a selector
resolves it against what exists.** The fallback becomes the selector's job.

**Growth.** Entries in the per-work-item maps exist only while their workspace is
open, and are dropped when it closes, so the maps hold one or two entries rather
than one per Story ever clicked. The cost is that reopening a closed Story lands
on Details rather than where you left it. The code already flagged the unbounded
shape: `SelectedTicketContent.tsx:630` notes the history chips "grow without
bound".

### 6.8 Where the copies were

A terminal session was held in **four** places — its query entry, the
`persistedIndex` query entry, `sessionStore.persistedSessions`, and
`sessionStore.sessions`. That is worse than the six holdings of a work item's
name that started all of this, and it went unnoticed because nothing ever failed.

Deleted as copies: `sessionStore.persistedSessions` and `.resumableSessions`;
`ticketWorkspaceStore.docs` (`DesignDoc[]`, also in `['documents', issueId]`) and
`.history` (`RunChip[]`, also in `['runs', issueId]`); `workspaceTabsStore.byTaskId`;
and the `persistedIndex` and `resumableIndex` query entries.

### 6.9 Doc chat is removed, not ported

The doc-chat overlay carried 37 references across 12 non-test files and the
largest share of the special-casing in the task workspace — a hidden category of
run that was "restored into `chatByTask`, never a tab" (`types.ts:86-87`), plus a
client index duplicating the run's own `doc_rel_path`. It is removed here and
rebuilt afterwards on the run-shaped workspace.

Runs already recorded with scope `docchat` are hidden and left alone. The
consequence is accepted knowingly: a doc-chat run that is still live has no
surface until the rebuild lands. The alternative — terminating such runs on sight
— was rejected because it destroys work a user did not expect to lose.

---

## 7. Rejected, with reasons

| Rejected | Why |
| --- | --- |
| Redux Toolkit as the single store (ADR-0009) | Its machinery existed to route around a cache it forbade to hold data; keying by item id removes the reason for all of it |
| `setQueryData` seeding from a batch reply | One-reply-many-keys fan-out — the defect's own shape — needing a standing exception |
| `staleTime: Infinity` | Only needed for a stampede that batching removes; also means "trust forever" where five minutes is honest |
| Nested-tree serializer | Bundles an entity with a collection against CODING-144; makes every optimistic move rebuild an ancestor path |
| Per-parent / filtered work-item reads | Puts the same rows in two entries; the exact defect CODING-142 names |
| Pessimistic writes | Deletes the most machinery, but the latency is felt on every edit |
| No global client store | Rewrites four correct files, loses the walk's single target, loses selector-level subscription on the hot path |
| Guarding on `updated_at` | The glossary names it as a thing to avoid; a timestamp is not a commit order |
| `@normy/react-query` | Syncs the copies rather than removing them; cannot move rows between lists; ignores the revision |
| Collapsing `AgentTerminalSession` here | Correct, but a migration in an app both Stories declare frozen — raised as its own Story instead |
| A `createClientStore` registry and lint rule | Withdrawn — it existed only to make many stores walkable, and one store is walkable by definition |
| The run projection inside the client store | Makes the walk's assertion conditional; a conditional invariant is the kind that decayed twice here |
| Keeping the tab list stored | It shadows a derivation the code already computes from the server's live list |
| Terminating live `docchat` runs on removal | Destroys work a user did not expect to lose |
| Porting doc chat as-is | 37 references and a hidden run category; rebuilt afterwards on the run-shaped workspace instead |

---

## 8. Open questions

- The batcher's window (10 ms) and chunk cap (100 ids) are starting values, not
  measurements. Revisit against a real module.
- Whether the `?ids=` read is a GET with a query string or a POST, decided by
  CODING-144 against its URL-length policy.
- Pagination remains deferred, and per-item entries change its shape: the tree
  read is what would paginate, not the records.

---

## 9. Invariants this establishes

1. A field of a thing is held in exactly one place.
2. A record's holding is keyed by that record's own id.
3. No code writes a reply into a key other than the key of the query that made
   it.
4. Membership is ids, sent as ids and held as ids.
5. A row holds an id and structural facts, never a field.
6. What is request-carried lives in a query entry; what is stream-carried lives
   in a store; nothing lives in both.
7. Freshness comes from the server saying so, not from time passing.
8. Every one of the above fails a test or a lint rule when broken. Prose
   invariants have been false twice here and have no mechanism of action.

---

## 10. Measurements

| | Claimed 2026-08-04 | Measured 2026-08-06 |
| --- | --- | --- |
| Non-test modules touching the doomed stores | "a little over two hundred" | 48 of 208 |
| Test files touching them | 80 of 89 | 45 of 114 |
| Stores backing the task workspace | not counted | 7, collapsing to 1 |
| Holdings of one terminal session | not counted | 4 |
| Non-test references to doc chat | not counted | 37 across 12 files |
| Fields in the client store | 18 stores, 6,530 lines | 23 fields, one store |

The left-hand side is a third of the size the earlier plan assumed — 69 test
files are untouched. The right-hand side is larger than it assumed, because the
task workspace's seven stores were never counted.
