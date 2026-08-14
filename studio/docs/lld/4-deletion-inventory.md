# LLD 4 — Deletion inventory

Every file the overhaul touches, and what happens to it.

**The rule for this document:** nothing is left behind a shim, a re-export or a
compatibility accessor. Both previous attempts at this defect introduced a
correct new mechanism and left the old one alive behind exactly that, and both
times nothing failed when a duplicate appeared. If a file is not in the new
design, it is deleted in the same change.

**One feature is removed as a feature: doc chat**, deliberately, rebuilt under
CODING-170. Everything else here is a duplicate, a stored derivation, or a shape
change. If a deletion looks like a feature disappearing and it is not doc chat,
stop and raise it.

---

## 1. Deleted outright — modules

| File | Reason |
| --- | --- |
| `features/studio/stores/tasksStore.ts` | holds records; replaced by `['tree']` + `['workItem']` |
| `features/studio/stores/taskTreeCache.ts` | stores the committed view — a derivation must not be kept |
| `features/work-items/issueStore.ts` | holds records; replaced by `['workItem', id]` |
| `features/work-items/internal/backlogStore.ts` | holds records and a second revision guard |
| `features/studio/lib/api.ts` | the second request layer; `shared/api/client.ts` remains |
| `features/studio/lib/presenter.ts` | re-shapes records for presentation — rows carry ids |
| `features/workflows/stateRemovalSync.ts` | exists to keep copied state **names** in step |
| `features/workflows/stateCatalogSync.ts` | same, for the catalogue overlay |
| `app/shell/ticket-workspace/selected-ticket/state/ticketWorkspaceStore.ts` | folded into the client store; `docs` and `history` were copies |
| `features/agents/terminal/internal/workspaceTabsStore.ts` | `byTaskId` is a stored derivation; the rest folds into the client store |
| `app/shell/ticket-workspace/tasks/hooks/useTaskTree.ts` | replaced by selectors over `['tree']` |

## 2. Deleted outright — types and values

| Symbol | Where | Reason |
| --- | --- | --- |
| `TaskSummary` | `features/studio/lib/types.ts:45-68` | the lossy re-shape; its optional fields exist only for the fabricated scratch row |
| `TaskDetails` | same, `:70-72` | a wrapper around `TaskSummary` |
| `ResumableTerminalSession` | `features/studio/lib/types.ts:95+` | every field is a run field; replaced by `['runs', issueId]` |
| `SCRATCH_STATE`, `makeScratchTask()` | `tasksStore.ts:70-88` | invents a workflow state and a record the server never sent |
| `DocTabState.label`, `.relPath` | `features/agents/types.ts:52-58` | copied from the `DesignDoc` record |
| `TabKind`'s `docchat` handling | across 12 files | removed with the feature |
| `focusRequest`, `focusSequence` | `workspaceTabsStore.ts:8-9` | an event modelled as state — [LLD 3 §5.1](3-task-workspace.md) |
| `chatByDoc` | `workspaceTabsStore.ts:7` | an index over the run's `doc_rel_path` |
| `activeBindings` | `uiStore.ts` | it is `bindingsStack.at(-1)` |
| `renameCollapsedState()` | `uiStore.ts:494-501` | keeps a copied state name in step |
| `hydrateExpandedForModule()` | `uiStore.ts:503-510` | unnecessary once the stored shape matches storage |

## 3. Stripped, not deleted

| File | Remove | Keep |
| --- | --- | --- |
| `features/agents/terminal/internal/sessionStore.ts` | `persistedSessions`, `resumableSessions`, copied run fields, `docchat` branches | transport state per session, `dismissedRuns` → the client store |
| `features/agents/terminal/queries.ts` | `persistedIndex` / `resumableIndex` getters and setters, the imperative `fetchQuery` wrappers | nothing — the file becomes the runs query or disappears |
| `features/agents/status/store.ts` | `workItemCursors` → the client store; the lossy `normalize()` re-shape | `runs`, `supersedes()`, `reconcileScope`, `prune` → `features/runs/projection.ts` |
| `app/.../documents/queries.ts` | imperative `fetchQuery` wrappers | the key shapes and the ETag digest handling |
| `features/studio/lib/types.ts` | everything in §2 | `IssueTypeOut`, `TaskState` and the types the new design still names |
| `features/studio/stores/uiStore.ts` | the whole file, after its fields move | — folded into `state/clientStore.ts` |
| `features/work-items/stores/selectionStore.ts` | the whole file, after its fields move | — folded; its `range(surface, id, orderedIds)` shape is the precedent to preserve |
| `app/stores/dialogStore.ts`, `toastStore.ts` | the whole files, after their fields move | — folded |

## 4. Kept untouched

| File | Why |
| --- | --- |
| `features/work-items/utilities/rank.ts` | the fractional-rank helper; needed for the optimistic reorder |
| `features/agents/terminal/internal/entryPool.ts` | xterm instances — live objects, [LLD 3 §5](3-task-workspace.md) |
| `features/agents/terminal/internal/terminalSocket.ts`, `browserTerminalClient.ts`, `tauriTerminalClient.ts`, `terminalClient*.ts` | transport; explicitly out of scope |
| `features/agents/terminal/internal/viewerLease.ts` | server-arbitrated, a different concern |
| `features/agents/terminal/internal/foregroundStore.ts` | a pointer at a live object |
| `features/agents/status/statusFeed.ts` | the socket protocol is out of scope; only its **destinations** change |
| `shared/storage/versioned.ts` | the persistence helper, reused for the v2 migration |
| everything under `src-tauri/` | desktop runtime |

---

## 5. The 48 modules, by what they need

Every non-test module referencing a deleted store. Grouped by the work required.

### 5.1 Read a record where they read a store (18)

Replace a store read with `useQuery(workItemQuery(id))`, or with a selector over
`['tree']`. No logic change.

```
app/shell/ticket-workspace/selected-ticket/details/BlockerChipView.tsx
app/shell/ticket-workspace/selected-ticket/details/ChildIssues.tsx
app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx
app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx
app/shell/ticket-workspace/selected-ticket/details/IssueSidebar.tsx
app/shell/ticket-workspace/selected-ticket/details/RunSubtreeAction.tsx
app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails.tsx
app/shell/ticket-workspace/selected-ticket/SelectedTicket.tsx
app/shell/ticket-workspace/selected-ticket/index.ts
app/shell/ticket-workspace/tasks/components/TaskRow.tsx
app/shell/ticket-workspace/ModuleTabStrip.tsx
app/onboarding/OnboardingTour.tsx
app/onboarding/OnboardingWelcome.tsx
features/studio/modals/ParentUpdate.tsx
features/studio/modals/StatusUpdate.tsx
features/studio/modals/PlanFeature.tsx
features/agents/terminal/ModuleFolder.tsx
features/work-items/hooks.ts
```

`TaskRow.tsx` is the important one: it must end up reading `item.name` from
`['workItem', id]` given a row that carries only the id. That is the reported
bug's fix.

### 5.2 Move to selectors over the tree (7)

```
app/shell/ticket-workspace/tasks/TasksPane.tsx
app/shell/ticket-workspace/tasks/storiesFocus.ts
app/shell/ticket-workspace/tasks/hooks/useTaskTree.ts        (deleted)
features/studio/lib/taskTree.ts                              (becomes selectors)
features/studio/lib/presenter.ts                             (deleted)
features/workflows/StateConfigurationPanel.tsx
features/workflows/WorkflowSettingsPanel.tsx
```

### 5.3 Move to mutations (5)

```
app/shell/ticket-workspace/tasks/components/IdeaEntry.tsx
features/studio/modals/AddModule.tsx
features/studio/modals/AddProject.tsx
features/work-items/index.ts
features/studio/lib/defaultProject.ts
```

### 5.4 Client-store consumers (8)

Change the import and the field names only.

```
app/navigation/full-sidebar-view/fullSidebarViewNavigation.ts   (+ cursors → ids)
app/navigation/navigationContext.ts
app/navigation/sharedNavigation.ts
app/shell/StudioShell.tsx
app/shell/sidebar/modules/ModulesPane.tsx                        (+ cursors → ids)
app/shell/sidebar/projects/ProjectsPane.tsx                      (+ cursors → ids)
features/studio/stores/uiStore.ts                                (folded)
features/studio/stores/configStore.ts                            (drop store imports)
```

### 5.5 Feed and bootstrap (4)

```
features/agents/status/statusFeed.ts        destinations change, protocol does not
app/startup/bootstrapStudio.ts              wire the client, the store, the feed
features/workflows/stateCatalogSync.ts      (deleted)
features/workflows/stateRemovalSync.ts      (deleted)
```

### 5.6 Deleted (6)

```
features/studio/stores/tasksStore.ts
features/studio/stores/taskTreeCache.ts
features/studio/lib/api.ts
features/studio/lib/types.ts                (partly — see §3)
features/work-items/issueStore.ts
features/work-items/internal/backlogStore.ts
```

---

## 6. Where a terminal session is held today

Four places, which is worse than the six holdings of a work-item name that
started this and went unnoticed for the same reason — nothing ever failed.

```
['terminalSessions','persisted',taskId]   query entry     → becomes ['runs', issueId]
['terminalSessions','persistedIndex']     query entry     → DELETE
sessionStore.persistedSessions            store           → DELETE
sessionStore.sessions                     store           → keep, transport only
```

---

## 7. Order of work on the branch

One branch, all at once — no intermediate state in which a compatibility layer
could survive. Within the branch, this order keeps the tree compiling longest:

1. `shared/query/keys.ts`, the batcher, `queries.ts`, `mutations.ts`.
2. `state/clientStore.ts` and `persistence.ts`, with the four old stores folded in.
3. `features/runs/projection.ts` and the feed's new destinations.
4. Selectors: rows, sections, order, search, visible expansion.
5. The 48 modules, in the §5 groups.
6. The task workspace: tab derivation, registry, documents; remove doc chat.
7. Delete everything in §1 and §2. **Nothing may import a deleted module before
   this step completes** — that is the check that no shim survived.
8. Tests — [LLD 5](5-testing.md).

**Before starting:** record the failing-test baseline at the branch point. Nine
vitest failures were recorded on 2026-08-03 as pre-existing; re-measure rather
than trusting that number, and diff against it at the end.
