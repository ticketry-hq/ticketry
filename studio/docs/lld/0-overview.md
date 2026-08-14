# Studio frontend overhaul — LLD 0: Overview

**Origin:** CODING-145. **Blocked by:** CODING-144.
**Decisions:** [`docs/decisions/2026-08-06-one-holding-per-thing.md`](../../../docs/decisions/2026-08-06-one-holding-per-thing.md)
**Records:** [`ADR-0010`](../adr/0010-per-work-item-query-entries-with-a-batched-read.md) (supersedes ADR-0009)
**Language:** [`studio/CONTEXT.md`](../../CONTEXT.md). Use its terms; do not invent synonyms.

Read this document first. It states the invariants every other document
implements. If any LLD contradicts an invariant here, the invariant wins and the
LLD is wrong.

---

## 1. The one-sentence design

Everything a server said lives in a query entry keyed by that thing's own id;
everything the person did lives in one client store; everything that arrives only
as a pushed value lives in one projection beside it; and everything else is
computed at read and thrown away.

---

## 2. Reading order

| If you are implementing | Read |
| --- | --- |
| anything at all | this document |
| reads, writes, the batcher, the feed | [LLD 1 — Server state](1-server-state.md) |
| selection, focus, expansion, tabs, persistence | [LLD 2 — Client store](2-client-store.md) |
| terminals, documents, runs, the tab strip | [LLD 3 — Task workspace](3-task-workspace.md) |
| deleting the old layer | [LLD 4 — Deletion inventory](4-deletion-inventory.md) |
| tests | [LLD 5 — Testing and enforcement](5-testing.md) |

---

## 3. The map

```
┌─ REACT QUERY ─ what the server said ─────────────────────────────┐
│  ['tree', moduleId]        root ids, parent→children, order      │
│  ['workItem', id]          one record            ← the batcher   │
│  ['runs', issueId]         runs, ended included                  │
│  ['documents', issueId]    the design documents                  │
│  ['docContent', docId, relPath]   bytes + digest, staleTime 0    │
│  ['states', projectId]  ['issueTypes', projectId]                │
└──────────────────────────────────────────────────────────────────┘
┌─ RUN PROJECTION ─ what the stream pushed ────────────────────────┐
│  runs: Record<RunId, RunLiveness>   state, updatedAt             │
└──────────────────────────────────────────────────────────────────┘
┌─ CLIENT STORE ─ what the person did ─────────────────────────────┐
│  23 fields. ids, booleans, numbers, stacks, typed text.          │
└──────────────────────────────────────────────────────────────────┘
┌─ REGISTRY ─ live objects, not values ────────────────────────────┐
│  xterm instances, sockets, viewer lease, foreground pointer      │
└──────────────────────────────────────────────────────────────────┘
┌─ DERIVED ─ computed at read, kept nowhere ───────────────────────┐
│  rows, sections, rank order, search hits, visible expansion,     │
│  the tab set, resolved active tab                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. The invariants

Each is enforced by a named mechanism in [LLD 5](5-testing.md). Prose invariants
have been false twice in this codebase and have no mechanism of action.

1. **One holding per thing.** A field of a thing is held in exactly one place.
2. **Keyed by identity.** A record's holding is keyed by that record's own id.
3. **No cross-key writes.** No code writes a reply into a key other than the key
   of the query that produced it.
4. **Membership is ids.** Sent as ids, held as ids, never as records.
5. **Rows carry ids.** A row holds an id and structural facts, never a field of
   the record it points at.
6. **Category separation.** Request-carried lives in a query entry;
   stream-carried lives in the projection; nothing lives in both.
7. **Push freshness.** Data is refreshed because the server said so, not because
   time passed.
8. **Intent, then validity.** The client store holds the person's last choice; a
   selector decides whether that choice still exists.

---

## 5. Categories, and how to decide

When adding anything, answer one question: **where did this value come from?**

| Origin | Home | Example |
| --- | --- | --- |
| A read | a query entry keyed by the thing's id | a work item's name |
| A pushed value | the run projection | a run's lifecycle state |
| The person | the client store | which row is selected |
| The person, unsent | the client store, as pending input | an unsaved document buffer |
| Computed from the above | nowhere — a selector | the ordered rows of a section |
| A live object with a lifecycle | the registry | an xterm instance |

If a value seems to belong in two rows of that table, it is two values and they
need different names. That confusion is what produced `TaskSummary`.

---

## 6. Module layout

```
studio/src/
  shared/
    api/
      client.ts              the ONE request layer (features/studio/lib/api.ts is deleted)
      workItemBatcher.ts     LLD 1 §3
    query/
      keys.ts                the query-key registry — LLD 1 §2
      queryClient.ts         defaults — LLD 1 §7
  state/
    clientStore.ts           the ONE client store — LLD 2
    persistence.ts           localStorage contract + migrations — LLD 2 §6
  features/
    work-items/
      queries.ts             tree + item reads — LLD 1 §4
      mutations.ts           every write — LLD 1 §5
      selectors.ts           rows, sections, order, search — LLD 1 §8
    runs/
      projection.ts          the run projection — LLD 3 §4
      feed.ts                the socket listener + cursor replay — LLD 1 §6
    terminals/
      registry.ts            xterm instances, focus() — LLD 3 §5
```

---

## 7. Hard dependency on CODING-144

Two things must land on the backend first. Neither is optional and neither has a
client-side workaround.

1. **The work-item change revision must advance for every published change.**
   `issue.py:110` advances it only when `state_id` changes, so a rename publishes
   no frame. With push-only freshness a missed bump never heals.
2. **`GET /work-items?ids=…`** must exist, accepting at least 100 ids.

CODING-144 also owns: one canonical collection read per scope, attachments read
separately, and the route registry.

---

## 8. Scope discipline

This overhaul **deletes aggressively**. Anything the new design does not use is
removed, not left behind a shim — that is how the previous two attempts failed.
[LLD 4](4-deletion-inventory.md) lists every file.

Exactly one feature is removed as a feature: **doc chat**, deliberately, rebuilt
afterwards under CODING-170. Everything else on the deletion list is a duplicate,
a stored derivation, or a shape change. If a change looks like a feature
disappearing and it is not doc chat, it is a mistake — stop and raise it.

**Not touched:** terminal transport, tmux lifecycle, the WebSocket protocol and
its cursor replay, document watching and the revision digest, visual design.
