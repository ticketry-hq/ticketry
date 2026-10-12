# Story moves

Move eligible Stories between Backlog and a sprint through buttons, keyboard or drag, with persisted membership and recoverable feedback.

Surfaces: browser, desktop
Editions: core

## Sub-features

- `moves-methods`: move real work with buttons, keyboard and drag, retain useful row focus and persist after reload (`manual-moves`).
- `moves-rollback`: pending writes disable repeats, failures roll back, and Retry / Undo converge membership (`manual-moves`).
- `moves-eligibility`: completed sprints reject incoming work while permitting existing work to return (`live-completion`).

## How to get to it

Open the project Plan tab (`workspace-tab-plan`), choose a sprint card's Plan button and select an epic. Use Plan <key> into sprint on a Backlog row or Return <key> to backlog on a sprint row. Drag a row between `plan-backlog` and `plan-sprint-items`, or use Alt+ArrowDown to plan and Alt+ArrowUp to return from a focused row. These move keys are local `PlanRow` handlers in `studio/src/features/sprints/planning/PlanPane.tsx`, not named configurable keymap actions. Enter/Space activates focused move buttons. Retry moving <key> to <destination>, Dismiss <key> failure and Undo <key> move appear in Plan feedback when applicable.

## Prerequisites

`TICKETRY_EDITION=core` must select the core edition (`__TICKETRY_EDITION__`; the default is `pocock`). Pocock-edition builds omit the Plan tab, Sprints workspace, move rows and their feedback; runtime settings cannot expose them. Select a sprint and epic with an eligible top-level backlog Story. Incoming moves require an uncompleted sprint and the active epic's eligible Backlog workflow state; outgoing moves require membership in that sprint. See `studio/src/features/sprints/planning/planMovePolicy.ts` and the [planner service reference](../planner-service.md) for the separate discovery contract.

## Expected behavior

Buttons, keys and drag change the Story's persisted sprint membership; returning clears it. The focused keyboard move advances focus to the next usable move button, then the previous one or pane heading if needed. Temporary read/eligibility gates preserve that handoff: the heading holds focus while its target is disabled, and the target regains focus once enabled. Deliberate pointer, keyboard or focus movement elsewhere ends the handoff. The sprint pane retains other epics' groups with dimmed presentation and permits their Stories to return. Nested Stories are excluded from Backlog. Empty panes say Nothing planned yet or Nothing unplanned in <epic>. `manual-moves` covers methods, next-row focus, cross-epic return, nested-row absence and reload; fallback focus and empty messages are grounded in `studio/src/features/sprints/planning/PlanPane.tsx` / `studio/src/features/sprints/planning/PlanStoryPanes.tsx`.

A pending write moves the row optimistically, sets `aria-busy`, disables its move button and dragging, and refuses duplicate writes. Failure restores the prior membership and shows Couldn't move with Retry and Dismiss; Retry converges the write and Dismiss removes failure feedback. Undo reverses a successful move when still eligible. `manual-moves` checks the persisted outcome, rollback, pending controls, Retry, Dismiss and Undo.

Completing a sprint while Plan is open disables incoming moves, including drag/key policy, while allowing its existing Stories to return to Backlog (`live-completion`, `studio/src/features/sprints/planning/planMovePolicy.ts`). Changing active epic cannot make a nested Story or one outside the Backlog workflow eligible. Loading/unavailable records refuse moves. Policy is rechecked at command time in `studio/src/features/sprints/planning/usePlanMoves.ts` and `studio/src/features/sprints/planning/usePlanVisitCoordinator.ts`.

## Verifying it

Browser cases: `studio/e2e/features/story-moves.spec.ts`.

Run `bun run --cwd studio test:e2e:feature story-moves`. Observe `plan-item-<key>`, `plan-move-<key>`, `[data-plan-story]`, pane headings, `plan-feedback` and `plan-undo`; assert pending state, dragging eligibility, focus and recoverable alerts. Poll public GraphQL membership and reload retained Plan.

Supplementary legacy inventory stays in `studio/e2e/planning-module-manual.spec.ts` and `studio/e2e/planning-module-lifecycle.spec.ts` until the final title audit. `studio/src/test/overhaulPocockEditionAcceptance.test.tsx` and `studio/vitest.pocock.config.ts` (`bun run --cwd studio test:pocock`) supplement compiled-edition coverage. Browser screenshots do not prove native rendering. `studio/src/test/overhaulPlanMoveFocusRecoveryAcceptance.test.tsx` (`overhaul-814`) supplements browser coverage with deterministic disabled-target recovery, later refetch disabling, deliberate-focus preservation and final-row heading fallback; run `bun run --cwd studio test -- src/test/overhaulPlanMoveFocusRecoveryAcceptance.test.tsx`.

## End-to-end suite

Suite: studio/e2e/features/story-moves.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `moves-methods` | @case-manual-moves @case-moves-empty-focus | n/a: Moves submit immediately without a cancellation dialog. | @case-manual-moves | @case-moves-empty-focus | @case-manual-moves @case-moves-empty-focus | @case-manual-moves @case-moves-empty-focus |
| `moves-rollback` | @case-manual-moves | @case-manual-moves | @case-manual-moves | n/a: Failure feedback exists only after a move request. | @case-manual-moves | @case-manual-moves |
| `moves-eligibility` | @case-moves-closed-sprint | n/a: Eligibility controls have no cancellation step. | @case-moves-closed-sprint | n/a: Eligibility requires an existing Story and sprint. | @case-moves-closed-sprint | @case-moves-closed-sprint |

## Relevant code

- [Move rows and drag panes](../../studio/src/features/sprints/planning/PlanPane.tsx) (`studio/src/features/sprints/planning/PlanPane.tsx`) and [pane grouping](../../studio/src/features/sprints/planning/PlanStoryPanes.tsx) (`studio/src/features/sprints/planning/PlanStoryPanes.tsx`).
- [Eligibility policy](../../studio/src/features/sprints/planning/planMovePolicy.ts) (`studio/src/features/sprints/planning/planMovePolicy.ts`), [move coordination](../../studio/src/features/sprints/planning/usePlanMoves.ts) (`studio/src/features/sprints/planning/usePlanMoves.ts`) and [feedback](../../studio/src/features/sprints/planning/PlanFeedback.tsx) (`studio/src/features/sprints/planning/PlanFeedback.tsx`).
- [Build policy](../../studio/scripts/edition-build-policy.mjs) (`studio/scripts/edition-build-policy.mjs`) and [edition seam](../../studio/src/shared/config/edition.ts) (`studio/src/shared/config/edition.ts`).
- [Planner service](../planner-service.md) owns discovery architecture rather than manual move behavior.

## Gotchas

The generic feature runner invokes the Chromium project, whose dependency in `studio/playwright.config.ts` runs `studio/e2e/onboarding.setup.ts`. That shared setup still uses the retired Modules-pane creation path; see [Onboarding gotchas](onboarding.md#gotchas). These are authored coverage pointers, not current passing journey proof until setup succeeds.

The preserved IDs were reconstructed from executable case identities; the historical Planning inventory was unavailable. Optimistic placement alone is not proof of persisted membership. Undo lasts five seconds, pausing while focused or hovered, and remains subject to current policy; feedback resets when the visit unmounts (`studio/src/features/sprints/planning/usePlanMoves.ts`). A completed sprint cannot receive work even if the Story's epic is selected. Native drag/focus behavior has not been established by the browser cases. No fresh live run is claimed by this entry.
