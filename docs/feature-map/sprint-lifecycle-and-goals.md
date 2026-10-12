# Sprint lifecycle and goals

The Sprints workspace groups project work by lifecycle, preserves numbered goals and completes unfinished work into a planned sprint or Backlog.

Surfaces: browser, desktop
Editions: core

## Sub-features

- `sprints-collection`: Empty collection, new-sprint creation, cancellation and collection read recovery.
- `sprints-reorder`: Planned-sprint order controls, boundaries, failure recovery and persisted order.
- `sprints-goals`: Numbered goals persist after reload; no goals disables discovery with a prerequisite (`agent-review`, `agent-recovery`).
- `sprints-lifecycle`: Start/Complete cancellation and failures recover while allowing only one active sprint (`sprint-lifecycle`).
- `sprints-carryover`: Complete carries only unfinished work to the selected planned sprint or Backlog (`sprint-lifecycle`).
- `sprints-external`: An open Plan responds to external completion and updates membership and outgoing-work eligibility (`live-completion`).
- `sprints-identity`: Retry a failed new-sprint collection refresh using its committed identity (`identity-recovery`).

## How to get to it

Activate **Plan** (`workspace-tab-plan`), then **Back to sprints** if a sprint opens. The **Sprints** collection provides **New sprint**, sprint-card **Plan**, **Start** and **Complete**, and the expandable completed-sprints history. **+ Goal** opens **New sprint goal**; Enter saves trimmed text and Escape cancels the draft. **Remove goal: <text>** removes an editable goal. **Find stories for these goals** starts discovery once prerequisites are ready; see [Background discovery and recovery](background-discovery-and-recovery.md).

The **Sprint name** form submits with Enter; Escape or **Cancel** closes it when idle. Lifecycle dialogs use **Cancel**, **Start sprint** and **Complete sprint**, with a destination combobox for unfinished work. These are direct form/control handlers, with no dedicated sprint lifecycle keymap actions. Use the top-strip keys documented in [Plan workspace navigation](plan-workspace-navigation.md).

## Prerequisites

Select a project in a core-edition build. The build input `TICKETRY_EDITION` (`pocock` default, `core`) becomes `__TICKETRY_EDITION__`; in the Pocock edition, Plan, Sprints, goals, discovery controls, focused sprint views and lifecycle dialogs are absent, and retained planning records do not enable them. The Pocock-edition harness is `studio/vitest.pocock.config.ts`. A planned sprint is required to Start and an active sprint to Complete; unfinished Stories and another planned sprint exercise carryover. Goals plus the baseline provider setup are needed for discovery. See [Planner service](../planner-service.md) for service contracts rather than duplicating them here.

## Expected behavior

- The collection shows active, planned and expandable completed cards, progress and work grouped by epic (or **No epic**). With no sprints, it says **Create a sprint to begin planning.** New sprint defaults to the next **Sprint N** name; cancel creates nothing. On success the new sprint opens in Plan. If creation commits but graph refresh fails, **Retry refresh** refreshes the same identity instead of creating another sprint. Source: `studio/src/features/sprints/SprintsList.tsx` and `studio/src/features/sprints/NewSprintButton.tsx`; cases `sprint-lifecycle` and `identity-recovery` cover creation/cancellation/refresh recovery.
- Goals appear as G1, G2, and so on and survive reload. No goals disables **Find stories for these goals** and explains **Add goals, then an agent can look for stories that fit them.** Completed goals are read-only. Goal read/write errors show an alert; read failure offers **Retry goals**. Source: `studio/src/features/sprints/goals/SprintGoals.tsx` and `studio/src/features/sprints/suggestions/SuggestionAgentBox.tsx`; `agent-review` covers persistence and the prerequisite, and `agent-recovery` preserves goals across discovery failure/cancellation.
- Start confirms without editing the sprint name; cancellation preserves planned state. Starting while another sprint is active is disabled with **Complete the active sprint first**. A failed Start reports an alert and permits resubmission. Complete confirms the done/unfinished counts; cancel preserves both lifecycle and membership. Busy lifecycle dialogs refuse duplicate submits/closing, and failure keeps the dialog available. Source: `studio/src/features/sprints/StartSprintDialog.tsx` and `studio/src/features/sprints/CompleteSprintDialog.tsx`; `sprint-lifecycle` covers Start error/retry and both cancellation paths.
- Complete moves unfinished Stories to the selected planned sprint or defaults to Backlog; done work stays in the completed sprint. Archived cancelled work is excluded from visible planning counts and retains its historical membership. An empty/all-done sprint has no destination combobox. Completed history keeps goals and omits **Plan** and **+ Goal**. `studio/e2e/planning-module-lifecycle.spec.ts` verifies membership and lifecycle through public GraphQL, including a second completion into Backlog.
- When another real browser page completes an open sprint, Plan disallows incoming work and new Story creation but permits returning its old work to Backlog. Undo that would restore work into the closed sprint is disabled with **This sprint is completed and closed to new work.** The `live-completion` case verifies these controls and persisted membership.
- Planned cards expose **Move sprint earlier** / **Move sprint later**; boundary controls are disabled and a failed reorder reports an alert. Source: `studio/src/features/sprints/SprintReorderControls.tsx`, `studio/src/features/sprints/SprintsList.tsx` and `studio/src/features/sprints/useReorderSprint.ts`. This ordering path is covered by the feature suite reorder case.

## Verifying it

Browser cases: `studio/e2e/features/sprint-lifecycle-and-goals.spec.ts`.

Run `bun run --cwd studio test:e2e:feature sprint-lifecycle-and-goals`. Observe `sprints-list`, `sprint-card-<id>`, numbered goals, lifecycle dialogs, alerts and progressbars; read authoritative sprint status, goals, order and Story membership through public GraphQL and reload.

Supplementary browser legacy inventory remains in `studio/e2e/planning-module-lifecycle.spec.ts`, `studio/e2e/sprint-planning.spec.ts` and `studio/e2e/planning-module-recovery.spec.ts`; its cases are retained until the final migration title audit. `studio/scripts/desktop-planner-acceptance.mjs` (`TICKETRY_EDITION=core bun run --cwd studio test:planner:desktop`; it refuses under Pocock) is adjacent native transport coverage and does not fill browser cells. `studio/src/test/overhaulPocockEditionAcceptance.test.tsx` and `studio/vitest.pocock.config.ts` (`bun run --cwd studio test:pocock`) supplement compiled edition coverage; `studio/src/test/overhaulCoreEditionAcceptance.test.tsx` covers the core edition.

## End-to-end suite

Suite: studio/e2e/features/sprint-lifecycle-and-goals.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `sprints-collection` | @case-sprint-collection-recovery | @case-sprint-collection-recovery @case-sprint-lifecycle | @case-sprint-collection-recovery @case-sprint-identity-recovery | @case-sprint-collection-recovery | @case-sprint-collection-recovery @case-sprint-lifecycle | @case-sprint-collection-recovery |
| `sprints-reorder` | @case-sprint-reorder-completion-recovery | n/a: Immediate reorder has no cancellation step. | @case-sprint-reorder-completion-recovery | n/a: Reorder requires planned cards; disabled boundaries are proven by the reorder case. | @case-sprint-reorder-completion-recovery | @case-sprint-reorder-completion-recovery |
| `sprints-goals` | @case-sprint-goals-recovery @case-sprint-lifecycle | @case-sprint-goals-recovery | @case-sprint-goals-recovery | @case-sprint-goals-recovery | @case-sprint-goals-recovery | @case-sprint-goals-recovery @case-sprint-lifecycle |
| `sprints-lifecycle` | @case-sprint-lifecycle | @case-sprint-lifecycle | @case-sprint-lifecycle @case-sprint-reorder-completion-recovery | @case-sprint-lifecycle | @case-sprint-lifecycle | @case-sprint-lifecycle |
| `sprints-carryover` | @case-sprint-lifecycle | @case-sprint-lifecycle | @case-sprint-reorder-completion-recovery | @case-sprint-lifecycle | @case-sprint-lifecycle | @case-sprint-lifecycle @case-sprint-reorder-completion-recovery |
| `sprints-external` | @case-live-completion | n/a: Observing committed external completion has no cancellation step. | n/a: External completion observation has no user write or dedicated failure control. | n/a: External completion observation requires an open sprint. | @case-live-completion | @case-live-completion |
| `sprints-identity` | @case-sprint-identity-recovery | @case-sprint-collection-recovery @case-sprint-lifecycle | @case-sprint-identity-recovery | n/a: Committed-identity recovery only exists after creation. | @case-sprint-identity-recovery | @case-sprint-identity-recovery |

## Relevant code

- `studio/src/features/sprints`: collection/cards, lifecycle dialogs, goals, planning surfaces, suggestion controls, mutations, selectors and generated operation callers; the other Plan entries detail those remaining behaviors.
- `studio/src/features/sprints/operations/sprints.graphql` and `studio/src/features/sprints/goals/operations/goals.graphql`: persisted sprint and goal read/write contracts.
- `studio/src/features/planning-graph/operations/planningGraph.graphql`: authoritative planning graph used for counts, grouping and membership.
- `studio/src/shared/config/edition.ts`, `studio/scripts/edition-build-policy.mjs`, `studio/vite.config.ts` and `studio/vitest.pocock.config.ts`: compile-time edition and Pocock-edition test configuration.
- [Planner service](../planner-service.md): backend lifecycle, planning and discovery implementation ownership.

## Gotchas

The generic feature runner invokes the Chromium project, whose dependency in `studio/playwright.config.ts` runs `studio/e2e/onboarding.setup.ts`. That shared setup still uses the retired Modules-pane creation path; see [Onboarding gotchas](onboarding.md#gotchas). These are authored coverage pointers, not current passing journey proof until setup succeeds.

- Wait for graph/goals/execution status to settle before asserting buttons; absent goals and unavailable status are distinct discovery prerequisites. Completed sprints retain history, while archived cancelled Stories do not contribute to visible progress.
- External completion needs two real pages sharing the same disposable project; a mocked refetch alone does not reproduce the browser journey. Completed Plan can still remove old work, so do not treat every disabled incoming control as a fully read-only workspace.
- Inspect wide/narrow controls, focus and overflow. Browser screenshots and fixture discovery do not establish native Tauri/libghostty behavior, native terminal retention or paid-provider execution; installed desktop lifecycle remains unverified here.
- Stable identifiers were reconstructed from executable case identities in the recovered Planning inventory because the historical original map was unavailable. Runtime settings cannot change the compiled edition; rebuild with a different `TICKETRY_EDITION` to change availability.
