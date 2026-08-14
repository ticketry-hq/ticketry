# LLD 1 — Server state

Implements invariants 1–4, 6 and 7 of [LLD 0](0-overview.md).

---

## 1. Rules

1. A record is held in the query entry keyed by its own id, and nowhere else.
2. A `queryFn` writes only its own entry. Never `setQueryData` for another key.
3. A collection read returns **ids**. It never returns records.
4. Freshness comes from the feed. Nothing polls, nothing refetches on focus.

Rule 2 is the one that is easy to break and hard to notice. If you find yourself
wanting to write several entries from one reply, you want [§3, the batcher](#3-the-work-item-batcher).

---

## 2. The query-key registry

`shared/query/keys.ts`. Every key in the application is declared here. A key
built inline anywhere else is a defect — the enforcement test in
[LLD 5 §3](5-testing.md) walks this registry.

```ts
export const keys = {
  tree:        (moduleId: ModuleId)  => ['tree', moduleId] as const,
  workItem:    (id: WorkItemId)      => ['workItem', id] as const,
  runs:        (issueId: WorkItemId) => ['runs', issueId] as const,
  runsScratch: (moduleId: ModuleId)  => ['runs', 'scratch', moduleId] as const,
  documents:   (issueId: WorkItemId) => ['documents', issueId] as const,
  documentsScratch: (moduleId: ModuleId) => ['documents', 'scratch', moduleId] as const,
  docContent:  (docId: DocId, relPath: string) => ['docContent', docId, relPath] as const,
  attachments: (issueId: WorkItemId) => ['attachments', issueId] as const,
  states:      (projectId: ProjectId) => ['states', projectId] as const,
  issueTypes:  (projectId: ProjectId) => ['issueTypes', projectId] as const,
} as const
```

**Only `keys.workItem` holds a work-item record.** `keys.tree` holds ids.
`keys.runs` holds runs. Nothing else holds a work item's fields.

Scratch surfaces get their own keys rather than a filtered variant of the
issue-keyed read, because the module scratch workspace has no work-item id.

---

## 3. The work-item batcher

`shared/api/workItemBatcher.ts`.

**Why it exists.** One holding per work item means one entry per id, which would
mean one request per id. The batcher collapses the requests without collapsing
the entries, so no reply is ever written outside its own key.

```ts
const WINDOW_MS = 10
const MAX_IDS   = 100          // URL length ceiling; see §3.3

type Pending = {
  resolve: (item: WorkItem) => void
  reject:  (err: unknown) => void
}

const pending = new Map<WorkItemId, Pending>()
let timer: ReturnType<typeof setTimeout> | null = null

export function fetchWorkItem(id: WorkItemId): Promise<WorkItem> {
  return new Promise((resolve, reject) => {
    const existing = pending.get(id)
    if (existing) {
      // Two subscribers asked for the same id inside one window. Chain, so
      // neither promise is dropped.
      pending.set(id, {
        resolve: (item) => { existing.resolve(item); resolve(item) },
        reject:  (err)  => { existing.reject(err);   reject(err) },
      })
      return
    }
    pending.set(id, { resolve, reject })
    timer ??= setTimeout(flush, WINDOW_MS)
  })
}

async function flush(): Promise<void> {
  timer = null
  const batch = new Map(pending)
  pending.clear()

  const ids = [...batch.keys()]
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS)
    try {
      const items = await api.listWorkItems({ ids: chunk })
      const byId  = new Map(items.map((x) => [x.id, x]))
      for (const id of chunk) {
        const item = byId.get(id)
        if (item) batch.get(id)!.resolve(item)
        else      batch.get(id)!.reject(new NotFoundError(id))
      }
    } catch (err) {
      // Per id, never one rejection for the whole batch: one unreadable row
      // must not blank every other row on screen.
      for (const id of chunk) batch.get(id)!.reject(err)
    }
  }
}
```

### 3.1 Behaviour contract

| Situation | Required behaviour |
| --- | --- |
| N ids requested inside the window | one request per `MAX_IDS` chunk, no more |
| the same id requested twice inside the window | one entry in the batch, both promises settled |
| a requested id absent from the reply | that promise rejects with `NotFoundError`; the others resolve |
| the request fails | every id in that chunk rejects with the transport error; other chunks are unaffected |
| a request arrives while a flush is in flight | it joins the next window; flushes never merge |

### 3.2 Choosing the window

10 ms is a starting value, not a measurement. Too short splits one mount into
several requests; too long delays first paint by that much. It is only ever paid
once per burst. Revisit against a real module and record the number here.

### 3.3 Chunking

100 ids of 36 characters plus separators is roughly 3.7 KB of query string, which
is comfortably inside every proxy default. If CODING-144 makes the batch read a
POST, raise `MAX_IDS` and note it here. Do not remove the chunking: it is also
the guard against a pathological module.

---

## 4. Reads

`features/work-items/queries.ts`.

```ts
export const treeQuery = (moduleId: ModuleId) => ({
  queryKey: keys.tree(moduleId),
  queryFn:  () => api.getModuleTree(moduleId),
  staleTime: FIVE_MINUTES,
})

export const workItemQuery = (id: WorkItemId) => ({
  queryKey: keys.workItem(id),
  queryFn:  () => fetchWorkItem(id),      // through the batcher, always
  staleTime: FIVE_MINUTES,
})
```

### 4.1 The tree payload

```ts
interface ModuleTree {
  rootIds:  WorkItemId[]                    // ordered
  children: Record<WorkItemId, WorkItemId[]>  // ordered; absent key = not loaded
  loaded:   Record<WorkItemId, boolean>     // explicit; see below
}
```

**"No children" and "children not loaded" are different facts and must not both
be an empty array.** `children[id] === undefined` with `loaded[id] === false`
means unknown; `children[id] === []` means genuinely childless. A row renders a
disclosure affordance for the first and none for the second.

### 4.2 Usage

```tsx
function StoriesPane({ moduleId }: { moduleId: ModuleId }) {
  const { data: tree } = useQuery(treeQuery(moduleId))
  const rows = useVisibleRows(tree)             // LLD 2 §5
  return rows.map((r) => <Row key={rowKey(r)} {...r} />)
}

function StoryRow({ id, depth }: WorkItemRow) {
  const { data: item } = useQuery(workItemQuery(id))
  if (!item) return <SkeletonRow depth={depth} />
  return <div>{item.name}</div>
}
```

Two hundred rows mount two hundred queries. That is intended: it is what makes
one record change repaint one row.

---

## 5. Writes

`features/work-items/mutations.ts`. Every write follows the same four steps.

```ts
export function useRenameWorkItem(moduleId: ModuleId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: RenameArgs) => api.patchWorkItem(id, { name }),

    async onMutate({ id, name }) {
      await qc.cancelQueries({ queryKey: keys.workItem(id) })
      const previous = qc.getQueryData<WorkItem>(keys.workItem(id))
      qc.setQueryData<WorkItem>(keys.workItem(id), (old) =>
        old ? { ...old, name } : old)
      return { previous }                       // the baseline lives here
    },

    onError(_err, { id }, ctx) {
      if (ctx?.previous) qc.setQueryData(keys.workItem(id), ctx.previous)
    },

    onSettled(_data, _err, { id }) {
      qc.invalidateQueries({ queryKey: keys.workItem(id) })
    },
  })
}
```

**The baseline lives in the mutation context**, which is outside every store and
every cache, so the enforcement walk in [LLD 5 §4](5-testing.md) stays strict.

`setQueryData` here writes the key of the record being mutated — its own key —
which does not breach rule 2.

### 5.1 Which writes exist

| Mutation | Endpoint | Optimistic field | Also invalidates |
| --- | --- | --- | --- |
| rename | `PATCH /work-items/:id` | `name` | — |
| edit description | `PATCH /work-items/:id` | `description` | — |
| change type | `PATCH /work-items/:id` | `issue_type` | — |
| set state | `PATCH /work-items/:id` | `state` | — |
| set parent | `PATCH /work-items/:id` | `parent_id` | `keys.tree` |
| set blockers | `PATCH /work-items/:id` | `blocked_by_ids` | the named blockers' entries |
| reorder | `POST /work-items/:id/reorder` | provisional `rank` | `keys.tree` |
| create | `POST …/work-items` | — (no id yet) | `keys.tree` |

**Structural writes also invalidate the tree**, because membership is a separate
holding and a parent change moves the id, not the record.

### 5.2 Reorder

The endpoint is already id-shaped — `reorderWorkItem(id, {before_id, after_id})`
(`shared/api/client.ts:198`) — so the write needs no record. The optimistic paint
needs a provisional `rank`, because the order is derived from it. Use the
existing `features/work-items/utilities/rank.ts`; it survives the deletions.

### 5.3 Create

A created work item has no id until the server replies, so there is nothing to
apply optimistically. Show the row as pending in the entry form, then invalidate
the tree. Do not invent a temporary id: it would need rekeying everywhere, which
is the machinery `tabRekeyed` exists for today and which this design removes.

---

## 6. The feed

`features/runs/feed.ts`. One socket, one listener, one place that invalidates.

```ts
socket.onmessage = (raw) => {
  const frame = JSON.parse(raw.data) as Frame
  switch (frame.type) {
    case 'work_item_change':
      invalidateWorkItem(frame.id)                  // debounced, §6.1
      if (frame.structural) invalidateTree(frame.module_id)
      cursor = Math.max(cursor, frame.revision)
      break
    case 'agent_lifecycle':
    case 'backend_session':
      runProjection.apply(frame)                    // LLD 3 §4 — values, not a read
      break
    case 'cursor':
      cursor = frame.revision
      break
  }
}
```

**A work-item frame carries identity and revision only**, so the client
invalidates and re-reads. **A run frame carries values**, so the projection
applies them directly. That asymmetry is in the protocol, not a choice made here.

### 6.1 Debounce

A subtree run publishes frames in bursts. Collect ids for 50 ms and invalidate
once per id per burst. Invalidation is cheap for an entry with no mounted
subscriber — it marks stale and fetches nothing — so the debounce protects
against redundant refetches of *visible* rows only.

### 6.2 Reconnect

```ts
const url = `${base}/status?cursor=${cursor}`
```

`apps/runs/consumers.py:29-57` replays every work item changed since that
revision and then sends the current revision. On reconnect, invalidate one entry
per replayed id and store the new cursor. This is why nothing needs to poll, and
it is already built — do not reimplement it.

The cursor is client state and lives in the client store ([LLD 2](2-client-store.md)).

---

## 7. Query client defaults

`shared/query/queryClient.ts`.

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,   // except the tree; see below
      retry: false,                // preserves pre-existing network behaviour
    },
  },
})
```

- `refetchOnMount` is left at its default. With a non-zero `staleTime` it is
  already a no-op; setting it false would say nothing extra.
- **The tree keeps `refetchOnReconnect: true`** as a cheap safety net — it is an
  ids-only payload, and a missed structural frame is the one gap the cursor
  replay cannot express as a per-item invalidation.
- **`docContent` overrides `staleTime` to 0.** Bytes on disk change outside
  Studio's knowledge and the client cannot prove a cached copy is current.
- `staleTime: Infinity` is forbidden. It was only ever needed to prevent a
  stampede that the batcher removes.

---

## 8. Selectors

`features/work-items/selectors.ts`. All are pure functions of the tree, the
records and client state. **None of them is stored.**

```ts
sectionsOf(tree, itemsById, states)     // group rows by state, ordered by rank
visibleRows(tree, expandedIds, collapsedStateIds, selectionId)
searchHits(tree, itemsById, query)
resolveActiveTab(intent, availableRuns, availableDocs)   // LLD 2 §4
```

A selector returns rows carrying **ids and structural facts only**:

```ts
type Row =
  | { kind: 'work-item'; id: WorkItemId; depth: number
      parentId: WorkItemId | null; expandable: boolean; expanded: boolean }
  | { kind: 'scratch'; moduleId: ModuleId }
```

Spreading a record into a row — `{ ...item, depth }` — is a defect. A memoised
selector keeps its output alive between renders, so a copied field becomes a
second holding. The row carries the id; the row component reads the record.

The `scratch` kind exists because the module scratch workspace is not a work item
and has no id, so it can have no entry. Nothing fabricates a record or a workflow
state for it.
