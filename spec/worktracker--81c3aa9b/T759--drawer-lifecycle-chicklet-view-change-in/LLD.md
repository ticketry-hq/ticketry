# CODIN-759 LLD: Drawer Lifecycle Chicklet

## Scope

Add the only Studio UI surface for the internal work-item lifecycle: a drawer chicklet beside the existing visible-state chip. The chicklet reads `task.lifecycle_state`, offers only the server-returned `task.lifecycle_transitions` plus `failed` and `cancelled`, posts the selected target to the guarded lifecycle route, and reconciles from the returned work item.

This slice does not add lifecycle storage, transition rules, API schema fields, or the guarded route. Those are owned by CODIN-758. It does not change `Issue.state`, board state columns, workflow configuration, or planning filters.

## Current Harness

| Area | Current file | Decision |
| --- | --- | --- |
| Drawer details | `studio/src/issue/IssueDetail.tsx` | Mount the lifecycle chicklet in the same status row as `StatePicker`. |
| Visible state picker | `studio/src/fields/StatePicker.tsx` | Leave as visible `State` rows only. Do not merge lifecycle into it. |
| Popover pattern | `studio/src/fields/Popover.tsx`, `PickerTrigger.tsx` | Reuse for the lifecycle picker. |
| API seam | `studio/src/lib/api.ts` | Add a small wrapper around generated `workItems.setWorkItemLifecycle`. |
| Drawer mutation store | `studio/src/stores/issue/issueStore.ts` | Add a lifecycle mutation action with rollback-on-rejection semantics. |
| Backlog reconciliation | `studio/src/stores/backlog/backlogStore.ts` | Use existing `applyServerItem(updated)` after successful lifecycle change. |
| Toasts | `studio/src/stores/ui/toastStore.ts` | Reuse `toast.error` for rejected transition/pairing responses. |
| Leak guards | board/filter/settings tests | Add regression coverage proving lifecycle values are not treated as visible states. |

## Implementation Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| UI location | Status row in `IssueDetail.tsx`, immediately after `StatePicker` | The acceptance criterion says beside the visible-state chip; this is the existing visible-state chip location. |
| Component | New drawer-scoped `LifecyclePicker` component | Keeps internal lifecycle UI separate from reusable visible-state controls. |
| Option source | De-duplicated `task.lifecycle_transitions` plus `failed` and `cancelled` | The server owns legal next transitions; terminals are explicitly always offered by the ticket. |
| Illegal targets | Not rendered | The UI cannot select them; the server still rejects stale or invalid pairings. |
| Current null state | Render a neutral `Not started` lifecycle chicklet | Fresh issues may have null lifecycle from CODIN-758; the control still shows the entry transitions. |
| Save model | No optimistic lifecycle jump before POST returns | The acceptance criterion says rejected transitions leave state unchanged; non-optimistic update is simpler and avoids visible rollback noise. |
| Success reconciliation | Replace open drawer task and backlog item with server response | The response includes authoritative `lifecycle_state` and fresh `lifecycle_transitions`. |
| Error behavior | Toast error, leave task unchanged | Matches existing mutation-error channel and server-guard requirement. |
| Types | Add a Studio `LifecycleState` union/label map around generated optional strings | Gives the UI stable labels/colors without making generated types the domain vocabulary. |

## File Change Map

| File | Delta |
| --- | --- |
| `studio/src/lib/types.ts` | Add `LifecycleState` union and keep `WorkItem.lifecycle_state` / `lifecycle_transitions` visible in the narrowed type. |
| `studio/src/lib/display.ts` or new `studio/src/lib/lifecycleDisplay.ts` | Add lifecycle label/color helpers. Prefer a new helper if `display.ts` is already visible-workflow oriented. |
| `studio/src/lib/api.ts` | Add `setWorkItemLifecycle(issueId, target)` wrapper using the generated SDK method. |
| `studio/src/fields/LifecyclePicker.tsx` or `studio/src/issue/LifecyclePicker.tsx` | New chicklet and popover; source options from `lifecycle_transitions` plus terminals only. |
| `studio/src/stores/issue/issueStore.ts` | Add `setLifecycle(target)` action, `saving.lifecycle_state`, success reconciliation, and toast-on-error. |
| `studio/src/issue/IssueDetail.tsx` | Mount the lifecycle picker beside `StatePicker` and wire it to `setLifecycle`. |
| `studio/src/test/IssueDetail.test.tsx` or new lifecycle-focused drawer test | Assert render, exact option set, success update, and rejected update toast/unchanged state. |
| `studio/src/test/backlogStore.test.ts` / `board.test.tsx` | Assert board columns/swimlanes ignore lifecycle values even when items carry them. |
| `studio/src/test/planningFilterDropdown.test.tsx` / `filterControls.test.tsx` | Assert state filter controls list only `State` rows. |
| `studio/src/test/SettingsView.test.tsx` | Assert workflow-config panel lists only configured visible workflow states. |

## Step Plan

1. Confirm CODIN-758 is present in the working tree: generated SDK has `setWorkItemLifecycle`, work-item payloads have `lifecycle_state` and `lifecycle_transitions`, and backend tests cover route guards.
2. Add the Studio lifecycle display vocabulary: accepted state ids, human labels, a neutral null label, and restrained status colors that do not reuse visible workflow `State` rows.
3. Add `setWorkItemLifecycle(issueId, target)` in the Studio API wrapper and surface `ApiError` through the existing `call` wrapper.
4. Extend `issueStore` with a drawer lifecycle mutation action. It reads the current open issue, sets only `saving.lifecycle_state`, posts the target, reconciles the returned task into both the open drawer and backlog store, and toasts/reverts by leaving the old task in place on error.
5. Build the lifecycle picker as a small popover control. It shows the current lifecycle label, disables while saving, computes options from `lifecycle_transitions` plus `failed` and `cancelled`, removes duplicates, excludes the current value when it would be redundant, and never reads from `useBacklogStore.states`.
6. Mount the picker in `IssueDetail.tsx` in the existing status row beside `StatePicker`. Hide only if the field is truly absent from payloads, to avoid breaking against an older API during local transition.
7. Add drawer tests for current-state rendering, exact option list, POST target call, success reconciliation to the new state/options, server rejection toast, and unchanged state after rejection.
8. Add leak-regression tests: `boardColumns()` and `boardSwimlanes()` use visible `states` only; `StatePicker`, board states filter, and `WorkflowStatesPanel` do not render lifecycle-only values that exist only on work items.
9. Run the focused Studio tests, then the Studio test suite or typecheck depending on implementation blast radius.

## Acceptance Harness

| Acceptance criterion | Test target |
| --- | --- |
| Drawer shows current internal lifecycle next to visible state | Render `IssueDetail` with an open issue carrying `lifecycle_state`; assert both visible state and lifecycle chicklet are present. |
| Picker lists exactly legal next transitions plus terminals | Seed transitions such as `["refining"]`; assert options are `refining`, `failed`, `cancelled` and no other lifecycle ids. |
| Valid transition updates state | Mock `setWorkItemLifecycle` returning updated work item; assert drawer and backlog store carry the returned lifecycle state/options. |
| Rejection shows toast and leaves state unchanged | Mock 422 `ApiError`; assert error toast and old lifecycle label remain. |
| Internal states never leak into visible surfaces | Seed work items with lifecycle values but keep `states` as visible rows only; assert board columns/swimlanes, state picker, board filter, and workflow config expose only `State` names. |

## Out Of Scope

- Backend lifecycle state machine, model field, migration, pairings, and route guard.
- MCP lifecycle tool.
- Execution engine persistence of lifecycle.
- Creating lifecycle rows in `State`.
- Changing board grouping, visible-state picker semantics, board filter semantics, or workflow configuration semantics.

## Green Signal

CODIN-759 is implementation-ready when the drawer has a single internal lifecycle control beside the visible-state chip, the option set is exactly server legal next transitions plus `failed` and `cancelled`, successful changes reconcile from the guarded route response, rejected changes toast and leave the old lifecycle intact, and regression tests prove lifecycle values never become visible workflow states.
