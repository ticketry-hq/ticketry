# LLD 2 — The client store

Implements invariants 1, 5 and 8 of [LLD 0](0-overview.md).

`state/clientStore.ts`. One zustand store. Seven stores collapse into it.

---

## 1. The rule

**Every value in this store is an id, a boolean, a number, a stack of things the
person did, or text the person typed.** Nothing a server said may be in it, and a
test asserts exactly that by serialising the whole store.

There is one store rather than several so that assertion needs no registry: a
slice added in two years is covered without anyone remembering to opt in.
Forgetting to opt in is this codebase's demonstrated failure mode.

**Not in this store:** the run projection ([LLD 3 §4](3-task-workspace.md)) and
live objects — xterm instances, sockets, the viewer lease, the foreground
pointer ([LLD 3 §5](3-task-workspace.md)). The projection is beside it so the
walk's assertion stays unconditional; live objects are outside it because a store
holding them cannot be serialised.

---

## 2. State

```ts
interface ClientState {
  // ── navigation & focus ──────────────────────────────────────────
  focusedPane: FocusedPane
  editViewZone: EditViewZone
  editViewBodyEngaged: boolean
  navigationModality: 'keyboard' | 'pointer'
  projectsCursorId: ProjectId | null
  modulesCursorId: ModuleId | null

  // ── layout (persisted) ──────────────────────────────────────────
  sidebarVisible: boolean
  panelLayout: number[] | null

  // ── keymap ──────────────────────────────────────────────────────
  modalStack: ModalDescriptor[]
  bindingsStack: KeyBinding[][]

  // ── tree view (persisted) ───────────────────────────────────────
  expandedIdsByModule: Record<ModuleId, WorkItemId[]>
  collapsedStateIds: Set<StateId>

  // ── selection & search ──────────────────────────────────────────
  selection: {
    surface: Surface | null
    ids: Set<WorkItemId>
    anchorId: WorkItemId | null
  }
  storySearchQuery: string

  // ── task workspace (entries exist only while a workspace is open) ─
  activeTabKindByWorkItem: Record<WorkItemId, TabKind>
  activeRunByWorkItem:     Record<WorkItemId, RunId>
  activeDocByWorkItem:     Record<WorkItemId, DocId>
  closedDocIds:      Set<DocId>
  dismissedRunIds:   Set<RunId>
  openOverlayDocIds: Set<DocId>

  // ── transient input ─────────────────────────────────────────────
  dirtyDocBuffers: Record<DocId, string>
  dialogs: DialogDescriptor[]
  toasts: Toast[]

  // ── feed ────────────────────────────────────────────────────────
  workItemCursor: number        // highest revision seen; LLD 1 §6.2
}
```

Twenty-four entries including the cursor.

---

## 3. Actions

Grouped as the state is. Every action takes ids; none takes a record.

```ts
// navigation & focus
focusLeft(): void
focusRight(): void
setFocusedPane(pane: FocusedPane): void
setEditViewZone(zone: EditViewZone): void
cycleEditViewZone(): void
setEditViewBodyEngaged(engaged: boolean): void
setNavigationModality(m: 'keyboard' | 'pointer'): void
moveProjectsCursor(delta: -1 | 1, orderedIds: ProjectId[]): void
moveModulesCursor(delta: -1 | 1, orderedIds: ModuleId[]): void
setProjectsCursor(id: ProjectId): void
setModulesCursor(id: ModuleId): void

// layout
toggleSidebar(): void
setSidebarVisible(v: boolean): void
setPanelLayout(sizes: number[]): void          // debounced persist, 400 ms

// keymap
pushModal(m: ModalDescriptor): void
popModal(): void
pushBindings(b: KeyBinding[]): void
popBindings(): void

// tree view
toggleExpanded(moduleId: ModuleId, id: WorkItemId): void
setExpanded(moduleId: ModuleId, id: WorkItemId, expanded: boolean): void
expandMany(moduleId: ModuleId, ids: readonly WorkItemId[]): void
toggleStateCollapsed(stateId: StateId): void

// selection
selectionToggle(surface: Surface, id: WorkItemId): void
selectionRange(surface: Surface, id: WorkItemId, orderedIds: WorkItemId[]): void
selectionReplace(surface: Surface, ids: WorkItemId[]): void
selectionClear(): void
setStorySearchQuery(q: string): void

// task workspace
openWorkspace(workItemId: WorkItemId): void     // creates the map entries
closeWorkspace(workItemId: WorkItemId): void    // drops them — see §7
setActiveTabKind(workItemId: WorkItemId, kind: TabKind): void
setActiveRun(workItemId: WorkItemId, runId: RunId): void
setActiveDoc(workItemId: WorkItemId, docId: DocId): void
dismissRun(runId: RunId): void
closeDoc(docId: DocId): void
reopenDoc(docId: DocId): void
setOverlayOpen(docId: DocId, open: boolean): void
setDirtyBuffer(docId: DocId, text: string | null): void

// feed
advanceCursor(revision: number): void
```

### 3.1 Actions take order, they do not hold it

`selectionRange`, `moveProjectsCursor` and `moveModulesCursor` receive the
ordered id list from the view at call time. The store never mirrors rendered
order. This is `selectionStore`'s existing precedent — its comment already says
"the store never has to mirror the rendered order" — generalised.

```ts
moveModulesCursor(delta, orderedIds) {
  const i = orderedIds.indexOf(get().modulesCursorId ?? '')
  const next = orderedIds[clampIndex(i + delta, orderedIds.length)]
  set({ modulesCursorId: next ?? orderedIds[0] ?? null })
}
```

An id that is no longer in the list falls back to the first row, visibly. The
previous implementation held an array position, which silently pointed at a
different row after a deletion.

---

## 4. Intent, then validity

The three `active*ByWorkItem` maps hold **the person's last choice**. They are
deliberately separate so that leaving a terminal for Details and coming back
lands on the same terminal.

They can therefore describe something that no longer exists — an active tab kind
of `terminal` whose run has since been dismissed. Resolving that is a
**selector's** job, not a correction written back into the store:

```ts
export function resolveActiveTab(
  intent: { kind: TabKind; runId?: RunId; docId?: DocId },
  availableRuns: RunId[],
  availableDocs: DocId[],
): ResolvedTab {
  if (intent.kind === 'terminal') {
    const runId = intent.runId && availableRuns.includes(intent.runId)
      ? intent.runId : availableRuns[0]
    return runId ? { kind: 'terminal', runId } : { kind: 'details' }
  }
  if (intent.kind === 'doc') {
    const docId = intent.docId && availableDocs.includes(intent.docId)
      ? intent.docId : availableDocs[0]
    return docId ? { kind: 'doc', docId } : { kind: 'details' }
  }
  return { kind: 'details' }
}
```

Never write the resolved value back. Writing it back destroys the intent, so
reopening a terminal that has come back would not return to it. The current code
patches this at the render site (`SelectedTicketContent.tsx:642`); here it is the
selector's contract.

---

## 5. Derived values

Computed at read, kept nowhere.

```ts
// Visible expansion is the remembered set plus the path to the selection.
// Ancestors are NOT written into the stored set: that set holds only what the
// person actually expanded.
visibleExpansion(moduleId, tree, selectionId) =
    new Set([...expandedIdsByModule[moduleId] ?? [],
             ...ancestorIds(tree, selectionId)])
```

Others live in [LLD 1 §8](1-server-state.md#8-selectors) and
[LLD 3 §3](3-task-workspace.md).

---

## 6. Persistence

Exactly four values persist, which is the contract today and does not change:

| Key | Holds |
| --- | --- |
| `studio.sidebarVisible:v2` | `sidebarVisible` |
| `studio.panelLayout:v1` | `panelLayout`, debounced 400 ms |
| `studio.expandedSubtasks:v1` | `expandedIdsByModule`, whole map |
| `studio.collapsedStates:v2` | `collapsedStateIds` — **new version** |

Everything else is session state and is deliberately not persisted.

### 6.1 The collapsed-sections migration

`collapsedStateNames` held workflow-state **names**; `collapsedStateIds` holds
ids. That needs a key bump and a one-time read migration, using the
`readVersionedItem` pattern already in `uiStore.ts:34-40` for the `plane-tui`
spellings:

```ts
readVersionedItem('studio.collapsedStates:v2', [
  'studio.collapsedStates:v1',      // names — map through the state catalogue
  'plane-tui:collapsed-states',     // names — same
])
```

Migrating requires the state catalogue, which is a read. If it has not arrived,
carry the legacy names forward unmigrated and convert on the first render that
has the catalogue. A name that matches nothing is dropped — that state was
deleted, and a collapse preference for a state that no longer exists is not worth
preserving.

### 6.2 Why the key changes at all

The name key was deliberate: it made a collapse follow the concept across
projects. With the Projects surface gated off there is one state row per name, so
id-keying behaves identically today and deletes `renameCollapsedState()` and the
`workflowStateRemovalSync` path — machinery whose only job was keeping a copied
name in step.

---

## 7. Lifetime of the workspace maps

`activeTabKindByWorkItem`, `activeRunByWorkItem` and `activeDocByWorkItem` hold
an entry only while that work item's workspace is open — inline or in a drawer —
and `closeWorkspace()` drops it. Typical size is one or two entries.

**Accepted cost:** reopening a Story you closed lands on Details rather than
where you left it.

`closedDocIds`, `dismissedRunIds` and `openOverlayDocIds` are flat sets keyed by
globally unique ids, so they need no per-work-item key. They live for the
session.

---

## 8. Subscription

Components select the narrowest slice they need, so one field changing repaints
one component:

```ts
const selected = useClientStore((s) => s.selection.ids.has(id))
```

Never `useClientStore((s) => s)`. Never destructure the whole store. A selector
returning a fresh object or array every call re-renders on every change — use
`useShallow` where a composite is genuinely needed.

---

## 9. What was deleted from the old stores

| Removed | Why |
| --- | --- |
| `expandedTaskIds` + `expandedModuleId` | replaced by `expandedIdsByModule`, which matches the persisted shape; the second field existed only to record whose set was loaded |
| `hydrateExpandedForModule()` | nothing to hydrate once the shapes match |
| `collapsedStateNames`, `renameCollapsedState()` | see §6.2 |
| `activeBindings` | it is `bindingsStack.at(-1)` |
| `projectsCursor`, `modulesCursor` as numbers | array positions into server-ordered lists |
| `chatByDoc` | an index over the run's own `doc_rel_path`; removed with doc chat |
| `focusRequest`, `focusSequence` | an event modelled as state; now a registry call — [LLD 3 §5](3-task-workspace.md) |
| `ticketWorkspaceStore.docs`, `.history` | copies of `['documents', …]` and `['runs', …]` |
| `workspaceTabsStore.byTaskId` | a stored copy of a derivation — [LLD 3 §3](3-task-workspace.md) |
| `sessionStore.persistedSessions`, `.resumableSessions` | copies of query entries |
