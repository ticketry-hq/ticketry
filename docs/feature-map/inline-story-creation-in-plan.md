# Inline Story creation in Plan

Create Stories in the active epic's Backlog or sprint pane with separate drafts and recovery that preserves committed identities.

Surfaces: browser, desktop

## Sub-features

- `create-drafts`: trim titles, cancel with Escape, keep separate pane drafts and persist parent and membership (`workspace-create`).
- `create-recovery`: recover failed assignment, refresh and uncertain delivery without duplicate Stories (`story-recovery`).

## How to get to it

Open the project Plan tab (`workspace-tab-plan`), choose a sprint card's Plan button and select an epic through Add epic. In `plan-backlog` or `plan-sprint-items`, choose Add story and type into Story title. Enter submits; Escape cancels the editor and returns focus to its button. These are local editor keys, not configurable keymap actions. See `studio/src/features/sprints/planning/InlineStoryCreation.tsx` and the existing cases below.

## Prerequisites

The build-time `TICKETRY_ROADMAP_ENABLED` choice must compile `__TICKETRY_ROADMAP_ENABLED__` as enabled. Roadmap-off builds omit the Plan tab, Sprints workspace and these inline editors; runtime URL or settings cannot enable them. Select an epic (or available No epic), use an uncompleted sprint and an available Story creation type, and wait for the planning graph. The [planner service reference](../planner-service.md) documents discovery execution separately; manual creation does not require a discovery run.

## Expected behavior

Enter trims the Story title; empty titles do not submit. Backlog creation persists the selected epic as parent with no sprint; sprint-pane creation persists the parent and assigns the new Story to that sprint. No epic supplies a null parent. Escape before submission discards the draft without creating a Story. A successful submit leaves an empty focused editor ready for another title, while the other pane's draft remains separate. Background collection refreshes preserve the mounted editors and their drafts; completion keeps any focus the planner deliberately moved to another control or pane. `workspace-create` checks trimming, cancel, separate drafts, focus, parent/membership readback and saved rows after reload; `studio/src/features/sprints/planning/InlineStoryCreation.tsx` supplies the blank-title and No epic guards.

Assignment failure says Story created; sprint assignment failed and offers Retry assignment using the created ID. Refresh failure says Story saved, but the view could not refresh and offers Retry refresh without another create. If delivery is uncertain, the editor says Could not confirm whether the story was created and offers Inspect backlog instead of a create retry. Dismiss closes recovery feedback. Busy editors refuse another submission; missing creation types show an error and completed sprints disable both Add story controls. Recovery identities and duplicate prevention are checked by `story-recovery`; the remaining guards are source-backed.

## Verifying it

Browser suite: `studio/e2e/features/inline-story-creation-in-plan.spec.ts`.

Run `bun run --cwd studio test:e2e:feature inline-story-creation-in-plan`. Each case owns a fresh browser profile and canonical onboarding. Cases drive production browser controls, inject only network failures, and read public GraphQL or reload for persisted writes. The generic runner's run summary records passing evidence; a source citation alone is not passing proof.

Supplementary browser provenance remains in `studio/e2e/planning-module-manual.spec.ts` and `studio/e2e/planning-module-recovery.spec.ts`; those legacy files stay unchanged until the final migration ticket. Their cross-feature cases do not fill this entry's cells.

Supplementary focus acceptance: `studio/src/test/overhaulPlanStoryCreationFocusAcceptance.test.tsx` (`overhaul-809`, `overhaul-810`) covers submitting-pane focus and intentional focus retention during fact-driven collection invalidation. These acceptance cases supplement the browser suite rather than fill its cells.

Supplementary Roadmap-off coverage is `studio/src/test/overhaulRoadmapOffAcceptance.test.tsx` via `bun run --cwd studio test:roadmap-off`. Browser screenshots cannot prove native rendering or paid-model behavior.

## End-to-end suite

Suite: studio/e2e/features/inline-story-creation-in-plan.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| create-drafts | @case-create-drafts, @case-create-no-epic-dismiss | @case-create-drafts | @case-create-rejection-busy | @case-create-drafts | @case-create-drafts, @case-create-no-epic-dismiss | @case-create-drafts, @case-create-no-epic-dismiss |
| create-recovery | @case-story-recovery | @case-create-no-epic-dismiss | @case-story-recovery, @case-create-rejection-busy | n/a: recovery requires a submitted Story; blank drafts belong to create-drafts | @case-story-recovery, @case-create-no-epic-dismiss | @case-story-recovery, @case-create-no-epic-dismiss, @case-create-rejection-busy |

## Relevant code

- [Inline editor](../../studio/src/features/sprints/planning/InlineStoryCreation.tsx) (`studio/src/features/sprints/planning/InlineStoryCreation.tsx`).
- `studio/src/features/sprints/planning/usePlanVisitCoordinator.ts`: retain the complete observed planning graph for rendering through cache eviction; commands still require current cache reads.
- [Draft slots](../../studio/src/features/sprints/planning/storyCreationEntries.ts) (`studio/src/features/sprints/planning/storyCreationEntries.ts`) and [pane composition](../../studio/src/features/sprints/planning/PlanSprintView.tsx) (`studio/src/features/sprints/planning/PlanSprintView.tsx`).
- [Build policy](../../studio/scripts/roadmap-build-policy.mjs) (`studio/scripts/roadmap-build-policy.mjs`) and [compiled gate](../../studio/src/shared/config/roadmapAvailability.ts) (`studio/src/shared/config/roadmapAvailability.ts`).
- [Planner service](../planner-service.md) owns the discovery architecture and execution contract.

## Gotchas

The case-isolated generic runner invokes the Chromium project and its canonical onboarding setup in `studio/e2e/onboarding.setup.ts`. See `studio/playwright.config.ts`; each invocation uses disposable data and the free provider fixture.

The preserved IDs were reconstructed from executable case identities; the historical Planning inventory was unavailable. A failed assignment can leave a real backlog Story, so retry its assignment rather than recreate it. Uncertain delivery requires inspection before any new create. Draft slots are visit/generation scoped, not a promise of draft persistence after leaving Plan or restarting the app. Wait for visible rows and authoritative identity/membership, not only disappearing feedback. This entry describes source and existing tests; no fresh live run is claimed.
