# Per-lifecycle agent chicklets on the "Local scratch workspace" row

## Problem

In the Studio Tasks pane, every real ticket row renders numbered per-lifecycle
agent chicklets (`AgentStateBadge` → one `LifecycleBadge` per raw lifecycle
state, each carrying its own count). The synthetic **"Local scratch workspace"**
row — the bucket for taskless `plan` and `instant` runs — instead renders a
single undifferentiated `● N` count (`ScratchCountBadge`,
`TaskRow.tsx:127`).

So a user scanning the tree can see *at a glance* that CODING-12 has two agents
working and one waiting for input, but for their scratch sessions they only
learn "3 agents exist" — not that one is blocked on a permission prompt.

The selector needed to fix this already exists and is already used elsewhere:
`selectScratchLifecycleChips` (`agents/status/selectors.ts:119`) powers the
scratch row's **details** pane (`DetailsTab.tsx` → `ScratchDetails`). Only the
tree row was never migrated.

## Current behaviour

| Surface | Component | Selector | Shows |
| --- | --- | --- | --- |
| Tasks pane, ticket row | `AgentStateBadge` | `selectTaskLifecycleChips` | numbered chips per state |
| Tasks pane, scratch row | `ScratchCountBadge` | `selectScratchRunCount` | single `● N` |
| Details pane, scratch row | `ScratchDetails` | `selectScratchLifecycleChips` | numbered chips per state |

Both scratch selectors read the same store (`useAgentStatusStore`), so this is
**not** a data-source change — but they disagree on membership in two ways:

1. **Run identity.** `selectScratchRunCount` matches `run.taskId === null`;
   `selectScratchLifecycleChips` matches `run.scope ∈ {plan, instant}`. A
   scratch **doc-chat** run has `taskId === null` but `scope === "docchat"`, so
   today's `● N` silently includes doc-chat overlay runs. That contradicts the
   terminal store's own stated rule (#625: *"a doc-chat run is never a tab and
   never inflates a count"*, `sessionStore.ts:260`).
2. **Dead runs.** `selectScratchRunCount` applies `isLiveAgentRunState`, which
   drops `exited` and `lost`. `selectScratchLifecycleChips` drops `exited` (not
   in `LIFECYCLE_STATE_ORDER`) but **keeps** `lost`.

## Decisions

- **Chicklets on the row.** Replace `● N` with the same numbered per-lifecycle
  chips ticket rows get.
- **Live runs only.** `lost` (and `exited`) produce no chip. Preserves today's
  count semantics; the scratch row deliberately differs from ticket rows here,
  which do surface `lost`.
- **`plan` + `instant` only.** Doc-chat runs are excluded. The visible number
  may therefore *drop* relative to today for users with scratch doc-chat
  overlays open — intended, and consistent with #625.
- **No automation chicklet.** `AutomationFailureChicklet` is keyed by issue id
  via `automationByTask`; the scratch bucket has no issue, so it stays off the
  scratch row.
- **One implementation.** The row and the details pane share a single
  `ScratchStateBadge` component and a single selector, so the two surfaces can
  never drift again. This makes the details pane live-only too — an intentional
  secondary change: it currently shows `lost`.

Live states after the change (from `LIFECYCLE_STATE_ORDER` minus `lost`), in
render order: `error`, `needs_input`, `permission_required`, `turn_complete`,
`working`, `starting`, `reconnecting`, `quiet`.

## Shape of the change

1. **`agents/status/selectors.ts`** — `selectScratchLifecycleChips` skips
   terminal states. Keep the `state.projectId !== projectId` guard, the
   `run.moduleId === moduleId` filter, and the `scope ∈ {plan, instant}` filter.
2. **`agents/lifecycle/ScratchStateBadge.tsx`** (new) — mirrors
   `AgentStateBadge`, but takes `projectId` / `moduleId` instead of
   `issueId` / `descendantIds`. Renders nothing when there are no chips.
   Carries `data-testid="scratch-run-chicklets"` (the id `ScratchDetails`
   already uses) and a `data-state` aggregate attribute. Exported from the
   `agents/lifecycle` barrel.
3. **`TaskRow.tsx`** — the `isScratch` branch renders
   `<ScratchStateBadge className="ml-2" />`. Delete the local
   `ScratchCountBadge` and the `useScratchAgentCount` import; the new component
   subscribes to project/module itself, so ordinary rows still never evaluate
   the scratch selector.
4. **`DetailsTab.tsx`** — `ScratchDetails` delegates to `ScratchStateBadge`,
   keeping its "No active Scratch runs." empty state for the zero case.
5. **Retire the dead count path** — remove `useScratchAgentCount`
   (`terminal/hooks.ts:84`) and `selectScratchRunCount`
   (`status/selectors.ts:160`) plus their barrel exports once no callers remain.
   The terminal store's separate, already-unused `selectScratchAgentCount`
   (`sessionStore.ts:251`) is **out of scope** — it has its own tests and no
   production caller.
6. **Tests** — seven `studio/src/test/*.tsx` files stub
   `useScratchAgentCount: () => 0`; those mocks must go away (seeding the agent
   status store directly is simpler than stubbing the new component).

## Acceptance criteria

- With scratch runs in mixed states in the selected module, the "Local scratch
  workspace" row renders one `LifecycleBadge` per state, each showing its own
  count, in `LIFECYCLE_STATE_ORDER`.
- With no live scratch runs, the row renders no badge at all (as today).
- A `lost` or `exited` scratch run contributes no chip.
- A scratch **doc-chat** run (`scope === "docchat"`) contributes no chip.
- Runs in a different module, or in a different project than the status feed's
  `projectId`, contribute no chip.
- The scratch row never carries an `AutomationFailureChicklet`.
- The scratch row and the scratch details pane render identical chips from the
  same component.
- With four or more distinct states, the row does not overflow horizontally —
  the task name truncates and the chips stay `shrink-0`.
- `npm run typecheck`, `npm run test --workspace @worktracker/studio`, and
  `npm run build --workspace @worktracker/studio` all pass, with the
  `useScratchAgentCount` mocks removed from the seven test files that carry
  them.

## Out of scope

- Clicking a chicklet to focus the matching plan/instant session.
- Breaking the counts out per scope (plan vs. instant shown separately).
- The module tab strip's `selectModuleLifecycleCounts` aggregate.
- Removing the terminal store's `selectScratchAgentCount`.
