# LLD 5 — Testing and enforcement

---

## 1. The principle

A test asserts what a person can observe: mount the real panes, mock the HTTP
boundary, assert on the DOM. It references no store, no query and no cache.

That coupling is why most of the existing suite breaks on every state change, and
removing it is a deliverable of this work rather than a side effect. It also
follows from the design: the rendered view exists only as what is on screen —
rows and selector output are recomputed every render and thrown away — so the
screen is the only honest place to assert it. A test that reads a selector's
output is checking a value nobody keeps.

There are exactly five exceptions, in §3 to §6. Each exists to fail when an
architectural invariant breaks, which is a different job.

---

## 2. The seam

One helper, used by every component test.

```tsx
// test/seam.tsx
export function mountStudio(opts: {
  http: HttpFixture               // msw handlers, or the fetch mock in use
  route?: string
}): RenderResult
```

It builds a fresh `QueryClient`, a fresh client store, a fresh run projection,
and a fake socket the test can push frames into. It exposes **none** of them.
A test that needs to reach inside is testing the wrong thing.

```tsx
export interface HttpFixture {
  tree(moduleId: ModuleId, tree: ModuleTree): void
  workItems(items: WorkItem[]): void      // served by GET /work-items?ids=…
  runs(issueId: WorkItemId, runs: Run[]): void
  documents(issueId: WorkItemId, docs: DesignDoc[]): void
  expectPatch(id: WorkItemId, body: unknown): Promise<void>
  failNext(status: number, body?: unknown): void
}
export interface FeedFixture {
  workItemChanged(id: WorkItemId, revision: number): void
  runLifecycle(runId: RunId, state: LifecycleState, at: string): void
  disconnect(): void
  reconnect(): void                       // asserts the cursor it sends
}
```

Prior art for this shape exists in the current suite for the details pane and the
tree hydration path; those two are the closest models.

---

## 3. Enforcement — the reported bug

The clearest statement of done. Deliberately library-agnostic: it would pass
against any correct implementation, including one that replaces everything here.

```tsx
test('a rename on the details page shows in the Stories pane', async () => {
  const http = fixture()
  http.tree('mod-1', treeOf(['story-1']))
  http.workItems([workItem({ id: 'story-1', name: 'Old name' })])
  mountStudio({ http })

  await screen.findByText('Old name')
  await userEvent.click(screen.getByRole('row', { name: /Old name/ }))
  const field = screen.getByLabelText('Name')
  await userEvent.clear(field)
  await userEvent.type(field, 'New name{Enter}')

  const pane = screen.getByRole('region', { name: 'Stories' })
  expect(await within(pane).findByText('New name')).toBeVisible()
  expect(within(pane).queryByText('Old name')).toBeNull()
})
```

## 4. Enforcement — store-wide uniqueness

Implementation-aware on purpose: its job is to fail when a slice starts holding a
record field. One `getState()`, no registry — that is why there is one store.

```ts
test('no part of the client store holds a work item field', async () => {
  // …rename 'Old name' → 'New name' through the DOM, as above…
  await waitFor(() => expect(dirtyBuffersEmpty()).toBe(true))

  const blob = JSON.stringify(clientStore.getState(), setAwareReplacer)
  expect(blob).not.toContain('Old name')
  expect(blob).not.toContain('New name')
})
```

Two details that matter:

- **Assert after the edit commits and the draft clears.** `dirtyDocBuffers` and
  an in-flight editor legitimately hold typed text; asserting mid-edit fails for
  the wrong reason.
- **`Set` does not survive `JSON.stringify`.** Use a replacer that expands sets
  and maps, or the test passes vacuously — which is the failure mode that lets
  the whole mechanism rot.

## 5. Enforcement — one entry per work item

```ts
test('no work item appears in two query entries', () => {
  const seen = new Map<WorkItemId, string[]>()
  for (const entry of queryClient.getQueryCache().getAll()) {
    for (const id of workItemIdsIn(entry.state.data)) {
      seen.set(id, [...(seen.get(id) ?? []), JSON.stringify(entry.queryKey)])
    }
  }
  for (const [id, atKeys] of seen) {
    expect(atKeys, `work item ${id} is held at ${atKeys.join(' and ')}`)
      .toHaveLength(1)
  }
})

test('no run field is held in both a query entry and the projection', () => { … })
```

`workItemIdsIn` looks for objects carrying work-item **fields**, not merely ids —
the tree entry holds ids by design and must not trip it.

This fails the moment somebody adds a per-item query beside the tree, or
reintroduces a hand-written index entry.

## 6. Enforcement — the batcher, and the lint rule

```ts
test('N ids inside the window leave as one request', async () => {
  const spy = http.spy()
  await Promise.all(ids20.map(fetchWorkItem))
  expect(spy.calls).toHaveLength(1)
  expect(spy.calls[0].searchParams.getAll('ids')).toHaveLength(20)
})

test('a batch above the cap splits and does not drop ids', async () => { … })   // 250 → 3 calls
test('one missing id rejects alone', async () => { … })                          // others resolve
test('a failed request rejects each id separately', async () => { … })
test('the same id twice in one window settles both promises', async () => { … })
```

**One lint rule**, so the mistake fails while it is being written:

```jsonc
// eslint: no-restricted-imports
{ "paths": [{
    "name": "@/shared/api/types",
    "message": "The client store may not hold record types. See LLD 2."
}], "files": ["src/state/clientStore.ts", "src/state/*.ts"] }
```

The `createClientStore` factory rule proposed earlier is withdrawn with the
registry: there is one store, so there is nothing to escape.

---

## 7. Re-authoring the 45 test files

45 of 114 reference a deleted store. **69 are untouched** — the client stores
survive as one store, so tests that only touch view state keep working.

| Group | Count | What to do |
| --- | --- | --- |
| Store unit tests | 8 | **Delete.** `issueStore`, `backlogStore`, `tasksStore*`, `taskTree*`, `planningFilterStore`, `workflowEditorStore`. They test the thing being removed. |
| `TaskSummary` fixture builders | 12 | **Re-author, not port.** They assert the lossy copy exists; a fixture of `WorkItem` at the HTTP boundary replaces them. |
| Component tests already at the DOM | 17 | **Rewire to the seam.** Same assertions, `mountStudio` instead of store setup. Cheapest group. |
| Feed and sync tests | 5 | **Re-author.** `statusFeed`, `studioTasksStateFeed`, `studioAgentStatusFeed`, `workflowStateRemovalSync` (delete — the machinery goes), `workflowStateReorderSync`. |
| Boundary and keymap | 3 | **Update paths.** `moduleBoundaries`, `studioKeymap`, `keybindingOverrides`. |

**Re-authored, not migrated, and the risk sits here.** Tests that construct
`TaskSummary` fixtures assert the copy exists; they cannot be ported, only
replaced. That means implementation and tests move together with no automated net
underneath, and user-visible behaviour is verified by hand. Writing the new suite
first against the current code was presented and declined; it is recorded here
because it is where the regression risk lives.

---

## 8. Behaviour to verify by hand

The 45-file rewrite leaves these unprotected during the change. Walk them on the
branch before merge.

1. Rename, re-describe, retype and reparent a Story — every pane updates at once.
2. Move a Story between states — the row moves section immediately.
3. Drag to reorder — the row lands, and survives the server reply.
4. A rejected write reverts visibly.
5. An agent edits through MCP while the pane is open — the change appears.
6. Cycle selection through a loaded list — no loading flash.
7. Collapse a branch — the subtree lifecycle chicklets still summarise beneath it.
8. Cycle live terminals with the keyboard, including into collapsed branches.
9. Kill a tmux session externally — the tab shows dead, and the run keeps its tab.
10. Close a terminal tab — it stays closed across a refetch.
11. Open two documents, edit one, switch tabs — the dirty buffer survives.
12. Reload — sidebar, panel layout, expansion and collapsed sections are as left.
13. A module scratch workspace opens, launches a run, and shows its chicklets.
14. Pull the network, then restore it — the cursor replay closes the gap and no
    stale row is left on screen.
