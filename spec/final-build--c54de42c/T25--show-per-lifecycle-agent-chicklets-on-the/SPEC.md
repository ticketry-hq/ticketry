# Show scratch lifecycle chicklets on the workspace row

## Problem Statement

The Studio Tasks pane gives users per-lifecycle agent counts for real ticket
rows, but the synthetic Local scratch workspace row only shows one combined
agent count. Users therefore cannot tell from the tree whether scratch agents
are working, waiting for input, blocked on permission, or in another live
lifecycle state.

The scratch row's combined count also uses broader membership rules than the
scratch details pane: it can include doc-chat overlay runs, while the details
pane can include a lost run. This makes the two views of the same scratch
workspace disagree.

## Solution

Show the Local scratch workspace row as numbered per-lifecycle chicklets in the
same visual language as ticket rows. A shared scratch lifecycle badge will
render the row and details-pane chips from the same selector so the two surfaces
cannot drift.

Only live plan and instant runs in the selected project and module contribute.
Exited, lost, doc-chat, task-bound, cross-module, and cross-project runs do not
produce scratch chicklets. The scratch row remains free of automation-failure
chicklets because it has no issue identity.

## User Stories

1. As a Studio user, I want the Local scratch workspace row to show separate
   lifecycle counts, so that I can understand scratch-agent activity without
   opening its details.
2. As a Studio user, I want multiple scratch runs in the same lifecycle state
   grouped into one numbered chicklet, so that the row remains compact.
3. As a Studio user, I want scratch lifecycle chicklets ordered consistently
   with ticket lifecycle chicklets, so that I can scan the tree predictably.
4. As a Studio user, I want runs waiting for input or permission to be visible
   independently from working runs, so that blocked work stands out.
5. As a Studio user, I want lost and exited scratch runs omitted, so that the
   row represents only live scratch activity.
6. As a Studio user, I want doc-chat overlay runs omitted, so that document
   conversations do not inflate the scratch workspace indicators.
7. As a Studio user, I want only plan and instant runs from the selected module
   shown, so that another module's agents do not appear in this row.
8. As a Studio user, I want status data from another project ignored, so that a
   stale or switching status feed cannot show misleading counts.
9. As a Studio user, I want the scratch row and scratch details pane to show the
   same lifecycle counts, so that changing surfaces never changes the apparent
   agent state.
10. As a Studio user, I want no scratch badge when there are no live qualifying
    runs, so that the row stays uncluttered.
11. As a Studio user, I want several distinct lifecycle chicklets to fit without
    widening the Tasks pane, so that the task name truncates while the status
    indicators remain readable.
12. As a Studio user, I want automation-failure indicators limited to real
    tickets, so that the synthetic scratch row does not imply an issue-backed
    automation attempt.

## Implementation Decisions

- Reuse the agent-status store; this change introduces no new backend, status
  feed, or persistence path.
- Define scratch membership as plan or instant scope in the selected module,
  guarded by the selected project matching the status feed's project.
- Filter terminal lifecycle states from scratch chips. In render order, the
  eligible states are error, needs input, permission required, turn complete,
  working, starting, reconnecting, and quiet.
- Keep task lifecycle behavior unchanged; real ticket rows may continue to
  surface lost runs.
- Introduce one scratch lifecycle badge component that owns the store
  subscription and renders the lifecycle badges for both the Tasks pane row and
  the scratch details pane.
- Give the shared badge the existing scratch-run test identifier and an
  aggregate lifecycle state attribute.
- Render nothing from the shared badge when no qualifying chips exist. The
  details pane separately retains its current empty-state message.
- Keep automation-failure chicklets off the synthetic scratch row.
- Remove the obsolete status-store scratch count selector and public terminal
  count hook after migrating their final production caller and test mocks.
- Leave the separate terminal-session-store scratch count selector unchanged.
- Leave the scratch run-id selector's membership unchanged. It feeds the
  workspace pane's mounted scratch terminals, which must keep a tab alive after
  its run exits, so it deliberately keeps terminal-state runs that the chip
  selector now drops. Restate that divergence where the two are documented as
  matching, so a later reader does not "restore" parity.

## Testing Decisions

- The primary behavior seam is the shared scratch lifecycle badge rendered
  against the agent-status store. Tests should assert visible lifecycle labels,
  counts, order, aggregate state, and the empty rendering case rather than
  internal component structure.
- Pure selector coverage should verify the membership boundary: plan and
  instant scopes only, matching project and module only, and no lost or exited
  runs. Existing agent-status selector tests provide the prior art.
- A Tasks pane integration test should verify the Local scratch workspace row
  shows the shared chicklets, omits automation-failure UI, and remains compact
  with several distinct states.
- A workspace details test should verify the same shared chicklets are used and
  that the existing “No active Scratch runs.” message remains for zero chips.
- Existing Studio tests that mock the removed scratch count hook should drop
  those mocks and seed the agent-status store when status behavior matters.
- Run the Studio typecheck, Studio test suite, and Studio production build.

## Out of Scope

- Clicking a chicklet to focus a matching plan or instant session.
- Showing plan and instant counts separately.
- Changing the module tab strip lifecycle aggregate.
- Removing or changing the terminal session store's separate scratch agent
  count selector.
- Changing lifecycle semantics for real ticket rows.
- Changing which runs mount as scratch terminal tabs in the workspace pane.

## Further Notes

Relevant implementation and test entry points for the next agent:

- `studio/src/features/agents/status/selectors.ts`
- `studio/src/features/agents/status/index.ts`
- `studio/src/features/agents/lifecycle/AgentStateBadge.tsx`
- `studio/src/features/agents/lifecycle/index.ts`
- `studio/src/features/studio/pages/tasks/components/TaskRow.tsx`
- `studio/src/features/studio/pages/workspace/tabs/DetailsTab.tsx`
- `studio/src/features/agents/terminal/hooks.ts`
- `studio/src/features/agents/terminal/index.ts`
- `studio/src/test/agentStatusStore.test.ts`
- `studio/src/test/AgentStateBadge.test.tsx`
- `studio/src/test/studioSubtreeLifecycleChicklets.test.tsx`
- `studio/src/test/studioWorkflowStateColors.test.tsx`
- `studio/src/test/studioIdeaEntry.test.tsx`
- `studio/src/test/studioTaskReorderDrag.test.tsx`
- `studio/src/test/studioTaskTreeHydration.test.tsx`
- `studio/src/test/studioStoriesSearch.test.tsx`
- `studio/src/test/studioModuleTabs.test.tsx`

The detailed design remains in
`spec/final-build--c54de42c/T25--show-per-lifecycle-agent-chicklets-on-the/DESIGN.md`.
