# LLD 3 — The task workspace

Implements invariants 1, 6 and 8 of [LLD 0](0-overview.md) on the right-hand side.

---

## 1. The domain, stated once

```
Work item  1 ──── *  AgentRun  1 ──── 0..1  AgentTerminalSession
                        └────── same id ─────────┘
```

- `AgentTerminalSession.agent_run` is a `OneToOneField` with `primary_key=True`
  (`backend/apps/terminals/models.py:9-15`), so the session's key **is** the run
  id and a run has at most one session, ever.
- The tmux session name is `pt-{run_id}` (`tmux/_core.py:76-79`) — derived, not
  data. Kill the session and recreate it and the name is the same. A run has one
  tmux identity for its whole life, so a reattach resurrects it rather than
  making another.
- A run can exist with no session — it never opened a terminal.

**Therefore: a terminal tab is a run.** A work item has many runs and so many
tabs. What is inside the tab is that run's tmux session.

The two tables duplicate each other in every column but `module_id` and
`doc_rel_path`; collapsing them is **CODING-167** and is out of scope here. This
document reads runs, which is the shape it keeps either way.

---

## 2. Where each fact lives

| Fact | Holding | Why |
| --- | --- | --- |
| a run's task, module, scope, agent, timing | `['runs', issueId]` | read by request |
| a run's liveness — `state`, `updatedAt` | the run projection | pushed as values, never read |
| the design documents | `['documents', issueId]` | read by request |
| document bytes and digest | `['docContent', docId, relPath]` | read by request, `staleTime: 0` |
| which tabs are open | derived — §3 | a consequence of the two above |
| the person's choices | the client store | [LLD 2](2-client-store.md) |
| xterm instances, sockets, the lease | the registry — §5 | live objects, not values |
| terminal byte streams | the renderer and the socket | never in a cache or a store |

**The run owns its own fields.** `taskId`, `moduleId`, `scope` and liveness are
removed from anything terminal-shaped, because a run with no terminal still has
all of them and must still be counted in its work item's subtree lifecycle
chicklets.

`terminated_at` is removed from the client read for the same reason — liveness is
the run's. That leaves the session read carrying only fields that never change
after the row is written, so it can never be stale.

---

## 3. The tab set

```
tabs(workItem) = runs with a live session
                 minus dismissedRunIds
                 ordered by started_at
```

Derived at read. `workspaceTabsStore.byTaskId` is deleted — it was a stored copy
of this.

```ts
export function useTerminalTabs(issueId: WorkItemId): TerminalTab[] {
  const { data: runs = [] } = useQuery(runsQuery(issueId))
  const dismissed = useClientStore((s) => s.dismissedRunIds)
  const liveness  = useRunProjection((s) => s.runs)
  return useMemo(
    () => runs
      .filter((r) => r.has_session && !dismissed.has(r.id))
      .sort(byStartedAt)
      .map((r) => ({ runId: r.id, agent: r.agent,
                     state: liveness[r.id]?.state ?? r.lifecycle_state })),
    [runs, dismissed, liveness],
  )
}
```

**`dismissedRunIds` is load-bearing.** `sessionStore.ts:725` already carries the
comment "re-fetch of the server's still-live list cannot resurrect the tab" —
that is a bug someone already hit. Without the dismissed set, closing a tab is
undone by the next fetch.

Deriving is not a behaviour change: the tab set is *already* seeded from the
server's live list and *already* needs the dismissed set. Only the stored shadow
goes.

### 3.1 The whole tab strip

```ts
type Tab =
  | { kind: 'details' }
  | { kind: 'doc'; docId: DocId }
  | { kind: 'terminal'; runId: RunId }
```

Details, then one tab per open document (`documents` minus `closedDocIds`), then
one per terminal tab. The active tab is `resolveActiveTab()` from
[LLD 2 §4](2-client-store.md#4-intent-then-validity) — stored intent, resolved
against what exists.

### 3.2 Selection paints, it does not load

Clicking a row writes an id to the client store. `<SelectedTicket />` reads that
id and then reads the record from `['workItem', id]`, which is already held, so
it paints in the same frame with no request. There is **no per-item read on
focus**; the old `openIssue()` background refresh existed because two stores held
different copies, and one holding removes the reason for it.

A loading state is correct only when the record is genuinely absent — a deep link
into a module that has not been read.

---

## 4. The run projection

`features/runs/projection.ts`. A small store, beside the client store, holding
what the stream pushes.

```ts
interface RunProjection {
  runs: Record<RunId, { state: LifecycleState; updatedAt: string }>
  apply(frame: RunFrame): void
  reconcile(scope: Scope, runs: RunRecord[], at: string): void
  prune(olderThan: string): void
}
```

**It is not a copy.** Liveness arrives only as values on the feed —
`statusFeed.ts:48-64` shows `frame.runs` on a snapshot and `frame.run` on a
lifecycle change — and is never read by request. So this is liveness's one
holding, which is why holding server-originated values here does not breach
invariant 1.

It is beside the client store, not inside it, so the client store's walk asserts
one unconditional sentence. A conditional invariant — "no server value except in
this slice" — is the kind that decayed twice in this codebase.

### 4.1 Ordering

```ts
function supersedes(incoming, current) {
  const cmp = Date.parse(incoming.updatedAt) - Date.parse(current.updatedAt)
  if (cmp !== 0) return cmp > 0
  // Equal timestamps: terminal beats non-terminal, so a late mid-turn frame
  // cannot revive a session the reaper has already killed.
  return TERMINAL.has(incoming.state) && !TERMINAL.has(current.state)
}
```

This is the run's **one** ordering rule, legitimately distinct from the work-item
change revision because a run has no revision. Keep the tie-break; it exists for
a real race.

`TERMINAL = {exited, lost, error}`. `lost` and `exited` are different facts:
`lost` means the session vanished underneath us, `exited` means it ended.

### 4.2 A dying tmux session

`session.py:424-450`: a reaper finds vanished sessions and dead panes, writes the
run as `exited` with `ended_at`, and publishes a `backend_session` frame —
`lost` for a soft-deleted session, `exited` for a clean end. The frame carries the
state, so the projection updates with no read.

**Because liveness lives only on the run, `['runs', issueId]` is invalidated when
a run starts, not when one ends.**

---

## 5. The registry

`features/terminals/registry.ts`. Live objects with a lifecycle — never
serialised, never walked, never in a store.

```ts
interface TerminalEntry {
  term:   XTerm
  socket: WebSocket
  focus:  () => void
}
const entries = new Map<RunId, TerminalEntry>()

export const registry = {
  set(runId: RunId, entry: TerminalEntry): void,
  get(runId: RunId): TerminalEntry | undefined,
  remove(runId: RunId): void,
}
```

A terminal registers itself on mount and removes itself on unmount. An xterm
instance holds the scrollback, so it must survive re-renders — this is why
`entryPool` exists today and why it is kept.

### 5.1 Focus

`focusRequest` and `focusSequence` are deleted. They were an event modelled as
state; the sequence number existed only to make an unchanged value re-fire an
effect, which is the tell.

```ts
// keymap handler, spawn flow, live-terminal cycling
registry.get(runId)?.focus()
```

No state, no counter, and no window in which the store describes a request that
has already been served.

### 5.2 The viewer lease

`AgentRunViewerLease` is server-arbitrated — one attached viewer per run. It is a
live-object concern and stays in the registry's neighbourhood. It is untouched by
this work and is **not** part of CODING-167 either.

---

## 6. Documents

```ts
useQuery({ queryKey: keys.documents(issueId), queryFn: … })      // registry
useQuery({ queryKey: keys.docContent(docId, relPath),
           queryFn: …, staleTime: 0 })                            // bytes + digest
```

Both become declarative `useQuery`. The imperative `fetchQuery` call sites go.

**Content is re-read whenever a tab opens.** An agent or the watcher can rewrite
the bytes at any moment, and the client cannot prove a cached copy is current.
The cost is one read per tab open; the alternative is rendering a document that
is already wrong.

**A dirty buffer is client state.** Unsaved text has not been sent, so it lives in
`dirtyDocBuffers` and must survive a refetch. Never write it into a query entry.

**Untouched:** the revision digest, the stale-save conflict flow, the
external-change banner, and the watcher. This Story does not go near them.

---

## 7. Byte streams

Terminal output goes from the socket to the xterm instance. It does not pass
through a query, a store, a reducer, or devtools. This is stated explicitly
because "everything in one place" would otherwise read as including stream
frames, and a store that saw them would be unusable.

---

## 8. The module scratch workspace

The scratch workspace belongs to a real module and to no work item
(`studio/CONTEXT.md`). It therefore has no work-item id and can have no entry.

- In the row model it is `{ kind: 'scratch'; moduleId }` — a distinct kind, not a
  fabricated record.
- Its runs and documents use their own keys: `keys.runsScratch(moduleId)`,
  `keys.documentsScratch(moduleId)`.
- `SCRATCH_STATE` and `makeScratchTask()` (`tasksStore.ts:70-88`) are deleted.
  Nothing invents a workflow state named "Scratch" or a record called "Local
  scratch workspace" again.

This is also what lets `WorkItem` keep every field required: `types.ts:50-67`
makes `key`, `rank`, `state_revision` and `updated_at` optional and names
"synthetic rows such as Scratch" as the reason, four times.

---

## 9. Doc chat is removed

37 references across 12 non-test files: the overlay, `openDocChat`, `docChatKey`,
`chatByDoc`, `overlayOpenByDoc`, and `docchat` branches in `sessionStore`,
`entryPool`, `liveTerminalCycle` and `hooks`. It carried the largest share of the
special-casing here — a hidden category of run, "restored into `chatByTask`,
never a tab" (`types.ts:86-87`) — and a client index duplicating the run's own
`doc_rel_path`.

**Runs already recorded with scope `docchat` are hidden and left alone.**
Accepted consequence: such a run, if still live, has no surface until the rebuild
lands. Terminating them on sight was rejected — it destroys work the person did
not expect to lose.

`scope` and `doc_rel_path` stay in the data, untouched. Rebuild: **CODING-170**.
