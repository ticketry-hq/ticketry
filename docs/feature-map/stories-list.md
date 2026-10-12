# Stories list

Stories provides the selected module's state-grouped work-item tree, inline idea capture, search, sprint filtering and root reorder.

Surfaces: browser, desktop
Editions: pocock, core

## Sub-features

- `stories-list-tree`: Select and expand work-item branches, with identifiers and collapsed descendant activity.
- `stories-list-inline-create`: Capture an unassigned Story under the selected module.
- `stories-list-root-reorder`: Drag root blocks within or between workflow-state sections.
- `stories-list-search`: Fuzzy-match names, canonical keys and sequence numbers while retaining ancestor paths.
- `stories-list-sprint-filter` (core): Filter eligible root branches by active, explicit, all or no sprint in the core edition.
- `stories-list-state-grouping`: Ordered workflow sections expose counts, collapse and configuration entry points.

## How to get to it

- Select a module tab; the Stories region contains `[data-pane="tasks"]`, `tasks-pane-body`, a tree and work-item `treeitem` rows carrying `data-task-id`. Click a row to open its [ticket details](ticket-details.md); **Expand subtasks** / **Collapse subtasks** toggles its branch.
- Focus **Capture an idea**, type a name and press Enter. ArrowDown moves to the first Story; Escape blurs the field without discarding its draft. These are local field handlers, not separate keymap actions.
- Action `search` defaults to `/` outside text input and focuses **Search stories**. ArrowDown enters the list; Escape clears search and returns focus to the tree. **Clear search** and the empty-state **Clear story search** also clear it.
- In the tasks keymap context, `tasks.next` / `tasks.previous` default to ArrowDown / ArrowUp; `tasks.activate` to Enter; `tasks.expand` / `tasks.collapse` to L / H, with fixed ArrowRight / ArrowLeft aliases. Close modal or Module Manager takeovers before using these actions.
- Drag a root row to another root's near/far edge or a state header; `ticket-drop-seam` marks the target. Click **Collapse <state>** / **Expand <state>** or **Configure <state> state** separately. The latter opens workflow configuration.
- In the core edition, open **Sprint: <selection>** below search. Choose **All sprints**, **No sprint**, active or historical sprint choices. The trigger accepts ArrowUp/Down, Enter and Space; the chooser owns its arrows, Enter/Space and Escape. **Show all sprints** removes sprint restriction.

## Prerequisites

Select a project and module and await module-tree, item and workflow-catalog reads. Inline capture requires a task-level issue type named **Story**, and the tree needs a project with at least one state and one task-level issue type (core-edition projects start without either; see [Projects](projects.md)); capture does not require a linked folder or provider execution. Use roots with children for expansion, two roots for reorder, and configured workflow transitions for cross-state drops. Sprint filtering requires a core-edition build and authoritative sprint/root membership; test ordinary reorder with empty search and, in the core edition, **All sprints**; Pocock never restricts Stories by sprint. Use [baseline disposable profiles](README.md#baseline-preconditions).

## Expected behavior

- Root Stories are grouped by state identity, ordered by catalog `sort_order` with group fallback, then rank. Descendants remain attached to their root branch. Rows display `T-<number> · <name>`; collapsed branches retain descendant activity indicators. Section counts count matching roots, not every descendant. Without search or sprint restriction every workflow state keeps its header, count `0` and **Configure <state> state** entry even when it has no roots; search and sprint restriction hide empty sections. Expansion reads missing children before displaying them. Source: `studio/src/features/work-items/selectors/taskTree.ts`, `studio/src/features/work-items/queries/useStoriesTree.ts` and `studio/src/app/shell/ticket-workspace/tasks/components/TaskRow.tsx`.
- Capture trims the name, ignores blank/duplicate in-flight submission, creates beneath the selected module with `sprint_id: null`, then clears and refocuses the field. It expands the destination state if collapsed and offers recovery if the new Story is outside current results. A rejected create preserves the draft and reports **Story could not be created: …**; switching project/module clears the old scoped draft and suppresses stale completion effects. A name typed right after a capture survives that capture's own `work_item.changed` convergence: the project's module list is re-read in place rather than evicted, so the workspace never flashes "no modules" and remounts the field (CODING-2868; `studio/src/features/planning-graph/convergence.ts`). Escape merely blurs. Source: `studio/src/app/shell/ticket-workspace/tasks/components/IdeaEntry.tsx`.
- When the selected project's cached catalogue has no task-level issue type or no state, the pane shows one **No workflow yet** line instead of search, sprint filter, sections or the tree, and **Capture an idea** is disabled with the same text as its placeholder, so typing and Enter write nothing and raise no failing toast. Module creation still works. This is the fresh core-edition project until a workflow is built (CODING-2860, CODING-2790). Source: `studio/src/app/shell/ticket-workspace/tasks/TasksPane.tsx` and `studio/src/features/workflows/queries/projectWorkflowPresence.ts`.
- Search is case-insensitive: every query word must match a substring or ordered character subsequence of key, sequence or name. Ancestors of matching descendants remain visible; search forces matching branches/state sections open without changing saved collapse intent. Clear restores ordinary rows. **No stories match "…".** and **Clear story search** distinguish an empty match set. In the core edition an empty sprint-restricted result says **No stories in this sprint.** and offers **Show all sprints**; the Pocock edition never shows either, and its query-less fallback reads **No stories.** (CODING-2863). Selection can remain open outside the results. Source: `studio/src/features/work-items/selectors/fuzzyMatch.ts`, `studio/src/features/work-items/filter/StoriesFilterEmptyState.tsx` and `studio/src/features/work-items/queries/useStoriesTree.ts`.
- Only root work items initiate reorder; a dragged root temporarily hides its descendants and restores them on cancellation/drop. Same-state drops write neighbor-relative order; cross-state drops first request the state update, then reorder after success. Reorder is disabled during search, sprint restriction or unresolved sprint reads. Refused writes converge back to server state; a cross-state move and rank write are separate requests, so do not assume an atomic combined operation. Source: `studio/src/features/stories/StoryTreeList.tsx`, `studio/src/features/work-items/useStoryReorderController.ts` and `studio/src/features/work-items/mutations.ts`.
- Sprint filtering retains whole eligible branches and shares project-scoped intent with module tabs. Loading and read failure are distinct from an empty sprint; **Retry** preserves Story search. State collapse remains usable under sprint restriction. Filter intent is session-only in Apollo and resets on reload; it is not a persisted preference. Source: `studio/src/features/work-items/internal/storySprintFilterStore.ts`. Pocock-edition builds hide the chooser and ignore remembered sprint restrictions. Source: `studio/src/features/work-items/filter/StorySprintFilter.tsx` and `studio/src/features/work-items/selectors/storySprintFilter.ts`.
- Persisted creates, parent/state changes and order must survive authoritative GraphQL readback and reload. Read back the created identity, module parent, null sprint, destination state and rank/order; then reload and reselect the module. Expansion/collapse are presentation preferences: reload checks them separately and is not server-write proof. Existing reorder/expansion round trips are cited below; capture server-readback/reload is a verification target, not claimed coverage.

## Verifying it

No live walkthrough was performed for this map. Observe tree order, `aria-selected`, `aria-expanded`, `data-task-id`, `tasks-pane-body`, `ticket-drop-seam`, accessible capture/search controls and status text. Existing coverage and narrow commands:

| Coverage | Existing cases | Narrow command |
| --- | --- | --- |
| State grouping, immediate moves, rollback, loaded selection and collapsed activity | `studio/src/test/overhaulWorkItemAcceptance.test.tsx`: `overhaul-25`, `overhaul-01`, `overhaul-02`, `overhaul-03`, `overhaul-04`, `overhaul-06`, `overhaul-07`. | `bun run --cwd studio test src/test/overhaulWorkItemAcceptance.test.tsx` |
| Row labels, key/number/descendant search and unmatched-search recovery | `studio/src/test/overhaulWorkItemRowAcceptance.test.tsx`: `overhaul-33`, `overhaul-369` and search-focus case. | `bun run --cwd studio test src/test/overhaulWorkItemRowAcceptance.test.tsx` |
| Root reorder, cancellation/branch restoration and equal imported ranks | `studio/src/test/overhaulStoryReorderAcceptance.test.tsx`: `overhaul-181`, `overhaul-182`. | `bun run --cwd studio test src/test/overhaulStoryReorderAcceptance.test.tsx` |
| Capture placement, unassigned sprint, rejection and pending-request guards | `studio/src/test/overhaulWorkItemCreationPlacementAcceptance.test.tsx`: `overhaul-240`; `studio/src/test/overhaulStorySprintCreationAcceptance.test.tsx`: `overhaul-586`–`overhaul-591`, `overhaul-594`, `overhaul-595`. | `bun run --cwd studio test src/test/overhaulWorkItemCreationPlacementAcceptance.test.tsx src/test/overhaulStorySprintCreationAcceptance.test.tsx` |
| No-workflow empty state, disabled capture without toast or write, and module creation (core) | `studio/src/test/overhaulCoreEmptyWorkflowAcceptance.test.tsx`: three `[CODING-2860]` cases; the default `vitest` config compiles core. | `bun run --cwd studio test src/test/overhaulCoreEmptyWorkflowAcceptance.test.tsx` |
| Reviewed workflow with enabled capture and no empty-state text (Pocock) | `studio/src/test/overhaulPocockReviewedWorkflowAcceptance.test.tsx`: one `[CODING-2860]` case; only the Pocock config includes it. | `bun run --cwd studio test --config vitest.pocock.config.ts src/test/overhaulPocockReviewedWorkflowAcceptance.test.tsx` |
| Draft survival across a capture's stream convergence | `studio/src/test/overhaulIdeaCaptureConvergenceAcceptance.test.tsx`: `overhaul-837`. | `bun run --cwd studio test src/test/overhaulIdeaCaptureConvergenceAcceptance.test.tsx` |
| Back-to-back capture without pauses, draft retention, authoritative readback and reload | `studio/e2e/features/stories-list.spec.ts`: `@case-stories-capture-back-to-back`. | `bun run --cwd studio test:e2e:feature stories-list --case stories-capture-back-to-back` |
| Filter branches, focus/cancel, drag restriction, loading/error/retry and counts | `studio/src/test/overhaulStorySprintFilterAcceptance.test.tsx`: `overhaul-476`–`overhaul-482`; history paging/search uses `studio/src/test/overhaulStorySprintPaginationAcceptance.test.tsx`: `overhaul-484`–`overhaul-487`. | `bun run --cwd studio test src/test/overhaulStorySprintFilterAcceptance.test.tsx src/test/overhaulStorySprintPaginationAcceptance.test.tsx` |
| Pocock-edition search, expansion, grouping and reorder | `studio/src/test/overhaulPocockStoriesAcceptance.test.tsx`: `overhaul-569`–`overhaul-572`. | `bun run --cwd studio test:pocock src/test/overhaulPocockStoriesAcceptance.test.tsx` |
| Pocock-edition Stories empty state and empty search carry no sprint wording | `studio/src/test/overhaulPocockSprintWordingAcceptance.test.tsx`: `[CODING-2863]` cases. | `bun run --cwd studio test:pocock src/test/overhaulPocockSprintWordingAcceptance.test.tsx` |
| Browser reorder/reload and expansion/collapse/reload | `studio/e2e/overhaul.spec.ts`: `overhaul-web-03`, `overhaul-web-12`; rollback is `overhaul-web-04`. | `bun run --cwd studio test:e2e e2e/overhaul.spec.ts --grep 'overhaul-web-(03|04|12)'` |
| Historical browser capture/search, reorder/group persistence and search shortcut | `studio/e2e/web-app.spec.ts`: **creates, switches, and searches the visible module workspace**, **reorders rows and preserves collapsed groups**, **focuses story search with a shortcut and returns to the tree**. Shared setup is stale; see Gotchas. | `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'creates, switches, and searches|reorders rows and preserves|focuses story search'` |
| Arrow-hold profiling, diagnostic rather than a performance budget | `studio/e2e/arrow-hold-profile.spec.ts` records held ArrowDown selection and GraphQL timings. | `bun run --cwd studio test:e2e e2e/arrow-hold-profile.spec.ts` |
| Server work-item name guards | `studio/e2e/work-management-guards.spec.ts`: blank/oversized work-item name refusal. This covers API guards, not capture UI; that spec's missing-identity case targets State writes. | `bun run --cwd studio test:e2e e2e/work-management-guards.spec.ts --grep 'work item name'` |

Mocked Vitest writes do not prove live persistence. No identified current browser case fully covers sprint chooser/history or capture rejection plus server-readback/reload, and no dedicated installed-desktop Stories journey closes those gaps. See [ticket details](ticket-details.md) for `studio/e2e/work-item-update-paths.spec.ts` and GraphQL update-surface coverage.

## End-to-end suite

Suite: studio/e2e/features/stories-list.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| stories-list-tree | @case-overhaul-web-06 @case-overhaul-web-12 @case-stories-search-tree | @case-stories-search-tree | @case-stories-tree-read-recovery | @case-stories-search-tree | @case-stories-search-tree @case-overhaul-web-06 | @case-overhaul-web-12 |
| stories-list-inline-create | @case-stories-capture-recovery @case-stories-capture-back-to-back | @case-stories-capture-recovery | @case-stories-capture-recovery @case-stories-name-guard | @case-stories-capture-recovery | @case-stories-capture-recovery | @case-stories-capture-recovery @case-stories-capture-back-to-back |
| stories-list-root-reorder | @case-stories-cross-state-recovery @case-overhaul-web-03 @case-stories-legacy-reorder | @case-stories-reorder-recovery | @case-stories-reorder-recovery @case-stories-cross-state-recovery | n/a: dragging requires two existing roots or a destination state | @case-overhaul-web-03 @case-stories-cross-state-recovery | @case-overhaul-web-03 @case-stories-legacy-reorder |
| stories-list-search | @case-stories-search-tree | @case-stories-search-tree | n/a: search computes a local projection with no network write | @case-stories-search-tree | @case-stories-search-tree | n/a: the transient search query is intentionally not persisted |
| stories-list-sprint-filter | @case-stories-sprint-recovery | @case-stories-sprint-recovery | @case-stories-sprint-recovery | @case-stories-sprint-recovery | @case-stories-sprint-recovery | n/a: project-scoped filter intent is session-only and deliberately resets after reload |
| stories-list-state-grouping | @case-stories-cross-state-recovery @case-overhaul-web-02 @case-overhaul-web-12 @case-stories-legacy-reorder | n/a: section collapse has no confirmation step | @case-stories-cross-state-recovery | @case-stories-empty-state-sections | @case-stories-tree-read-recovery @case-overhaul-web-12 | @case-overhaul-web-12 @case-stories-legacy-reorder |

The browser suite is `studio/e2e/features/stories-list.spec.ts`.

`@case-stories-sprint-recovery` is tagged `@edition-core` and runs only in core-edition runs. The edition-neutral reorder, cross-state and tree-read cases widen the core sprint filter to **All sprints** only when the run's edition is core; Pocock has no chooser to widen. Case citations identify the intended browser proof; they are not passing-run claims. The feature runner records actual outcomes. The five State/IssueType-only cases in `studio/e2e/work-management-guards.spec.ts` belong primarily to workflows-and-issue-types (CODING-2717); the WorkItem create-name guard migrates to Stories. Legacy specs remain intact until the final retirement ticket.

## Relevant code

- `studio/src/features/stories`: root-block tree rendering and drag grouping.
- `studio/src/app/shell/ticket-workspace/tasks`: production Stories pane, inline capture, search, headers, row wrappers and focus helpers.
- `studio/src/features/work-items/queries/useStoriesTree.ts`, `studio/src/features/work-items/selectors/taskTree.ts`, `studio/src/features/work-items/selectors/fuzzyMatch.ts` and `studio/src/features/work-items/selectors/storySprintFilter.ts`: canonical tree projection, ordering and filtering.
- `studio/src/features/workflows/queries/projectWorkflowPresence.ts`: cache-only workflow presence check and the **No workflow yet** text.
- `studio/src/features/work-items/filter/StorySprintFilter.tsx`, `studio/src/features/work-items/filter/StorySprintFilterController.tsx` and `studio/src/features/work-items/filter/StoriesFilterEmptyState.tsx`: chooser, intent and recovery.
- `studio/src/features/work-items/useStoryReorderController.ts`, `studio/src/features/work-items/internal/ticketReorder.ts`, `studio/src/features/work-items/mutations.ts` and `studio/src/features/work-items/operations/workItems.graphql`: server writes and convergence.
- `studio/src/features/planning-graph/convergence.ts`: refreshes project membership facts in place to retain the selected workspace and capture draft during work-item changes.
- `studio/src/features/work-items/components/PlanningRowView.tsx`, `studio/src/app/navigation/keymapBindings.ts` and `studio/src/app/navigation/sharedNavigation.ts`: row selectors and navigation entry points.

## Gotchas

- `studio/e2e/web-app.spec.ts` calls shared `openModule` in `studio/e2e/support.ts`, which waits for the selected module tab and module workspace region (CODING-2847); other cases use the retired `pane-modules` directly. Those cases are historical coverage pointers, not confirmed runnable current journeys. `studio/e2e/overhaul.spec.ts` selects its prepared module tab directly.
- The [historical e2e skill](../../.claude/skills/e2e/SKILL.md) still says Django starts; current Playwright configuration starts the Rust GraphQL adapter through the web launcher. Follow the index's runtime instructions.
- Under core, a fresh project has no workflow, so browser journeys that capture Stories in one need a workflow first (CODING-2790); no core browser case covers the **No workflow yet** state yet.
- Root-only dragging is not child reparenting. Search and sprint restriction deliberately disable it; empty filtered results do not mean records were deleted. The Conversations/scratch section is separate from workflow state groups; see [descriptions and documents](descriptions-and-documents.md).
- Default chords can be overridden. Text fields own their local Enter/Escape/ArrowDown behavior; modal/manager focus changes routing. Arrow profiling does not establish a latency budget or native terminal behavior. Unverified runtime paths remain explicitly unverified until walked through the relevant surface.
