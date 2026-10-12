# Epic planning

Choose epic visits in Plan, create epics, and review their backlog and suggestions without losing sprint membership.

Surfaces: browser, desktop
Editions: core

## Sub-features

- `epics-visits`: counts, pending suggestions and visit selection survive closing/reopening; Done focuses the neighbor (`workspace-create`, `agent-review`).
- `epics-no-epic`: ungrouped existing suggestions remain reachable and match pending counts (`agent-review`).
- `epics-creation`: create an epic and recover its committed identity after a failed refresh without duplicate creates (`identity-recovery`).
- `epics-membership`: epic groups reflect real Story moves, rollback and Undo (`manual-moves`).
- `epics-bulk`: Add all applies only the active epic's suggestions with stable goal attribution (`bulk-review`).

## How to get to it

Open the project Plan tab (`workspace-tab-plan`), then a sprint card's Plan or Review in Plan → button. Use Add epic to open an existing epic or No epic; + New epic opens New epic name, Enter submits, and Escape cancels. Select an epic tab, Next epic, Close <epic> or Done with <epic> → next. These production paths are exercised by the linked cases below.

Epic cycling uses local Plan keyboard handling: Alt+[ / Alt+] (`BracketLeft` / `BracketRight`), rather than a named configurable keymap action. Enter activates focused buttons. See `studio/src/features/sprints/planning/planKeyboardNavigation.ts` and `studio/src/features/sprints/planning/NewEpicChip.tsx` in the planning folder.

## Prerequisites

The core edition must be selected at build time: `TICKETRY_EDITION=core` resolves to the compiled `__TICKETRY_EDITION__` constant read only by `studio/src/shared/config/edition.ts` (`editionHas("sprintPlanning")`); the default is `pocock`. In a Pocock-edition build the Plan tab, Sprints workspace, epic controls and suggestion review are absent; runtime settings cannot enable them. A project and sprint must exist; new epics require an available Epic creation type. Suggestion scenarios require published waiting suggestions. Use the [planner service reference](../planner-service.md) for discovery execution and provider setup.

## Expected behavior

The epic tab's accessible name reports its backlog Story count and waiting suggestion count. Closing a visit does not dismiss its suggestions: Add epic can reopen it. Explicit Close or Done with the final epic focuses Add epic; Done with an epic otherwise selects and focuses the neighbor. Background reconciliation that removes the last unavailable or deleted epic preserves focus in an unrelated mounted editor. Returning from Sprints retains the visit's closed/open selection within that session. No epic exposes ungrouped Stories or waiting suggestions when present. The sprint pane retains Stories from other epics, with those groups dimmed. These outcomes are covered by `workspace-create`, `agent-review` and `manual-moves`.

Creating an epic trims its name and selects the committed epic after refresh. Escape cancels an unsubmitted name without a create. A failed refresh offers Retry refresh, which rereads the existing identity rather than creating again (`identity-recovery`); empty names and creation errors are guarded in `studio/src/features/sprints/planning/useEpicEntry.ts`. With no open epic, Backlog says No epic open. Use + Add epic to plan another one.

Story moves change persisted sprint membership and the derived epic grouping; failed writes roll back and Undo restores membership (`manual-moves`). Add all accepts only the active epic's waiting suggestions, leaving the other epic's count intact; G-number goal attribution survives removed goals (`bulk-review`).

## Verifying it

Browser suite: `studio/e2e/features/epic-planning.spec.ts`.

Run `bun run --cwd studio test:e2e:feature epic-planning`. Each case owns a fresh browser profile and canonical onboarding. Cases drive production browser controls, inject only network failures, and read public GraphQL or reload for persisted writes. The generic runner's run summary records passing evidence; a source citation alone is not passing proof.

Supplementary browser provenance remains in `studio/e2e/planning-module-manual.spec.ts` and `studio/e2e/planning-module-recovery.spec.ts`; those legacy files stay unchanged until the final migration ticket. Their cross-feature cases do not fill this entry's cells.

Supplementary Pocock-edition coverage is `studio/src/test/overhaulPocockEditionAcceptance.test.tsx` via `bun run --cwd studio test:pocock`. Browser screenshots cannot prove native rendering or paid-model behavior.

Mounted focus acceptance is `studio/src/test/overhaulPlanBackgroundEpicFocusAcceptance.test.tsx`: incoming graph removal of the final epic preserves a persistent unrelated editor's focus, while explicit final Close and Done hand focus to Add epic. The browser `@case-epic-visits` journey also asserts both explicit final-tab handoffs.

## End-to-end suite

Suite: studio/e2e/features/epic-planning.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| epics-visits | @case-epic-visits, @case-epic-bulk-no-epic | @case-epic-visits | n/a: opening and closing local visits have no write or retry path | @case-epic-visits | @case-epic-visits | n/a: open epic visits are session state; restart retention is not promised |
| epics-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic |
| epics-creation | @case-epic-visits, @case-identity-recovery | @case-epic-visits | @case-identity-recovery | @case-epic-visits | @case-epic-visits | @case-identity-recovery, @case-epic-visits |
| epics-membership | @case-epic-membership | @case-epic-membership | @case-epic-membership | @case-epic-visits | @case-epic-membership | @case-epic-membership |
| epics-bulk | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic | @case-epic-bulk-no-epic |

## Relevant code

- [Epic UI and coordination](../../studio/src/features/sprints/planning/) (`studio/src/features/sprints/planning/`): `studio/src/features/sprints/planning/EpicTabStrip.tsx`, `studio/src/features/sprints/planning/NewEpicChip.tsx`, `studio/src/features/sprints/planning/useEpicEntry.ts`, `studio/src/features/sprints/planning/epicTabs.ts`, `studio/src/features/sprints/planning/epicMembership.ts`, `studio/src/features/sprints/planning/usePlanVisitCoordinator.ts` and `studio/src/features/sprints/planning/PlanSprintView.tsx`.
- [Plan visit state](../../studio/src/features/sprints/planWorkspaceState.ts) (`studio/src/features/sprints/planWorkspaceState.ts`).
- [Build policy](../../studio/scripts/edition-build-policy.mjs) (`studio/scripts/edition-build-policy.mjs`) and [edition seam](../../studio/src/shared/config/edition.ts) (`studio/src/shared/config/edition.ts`).
- [Planner service](../planner-service.md) owns the discovery architecture and execution contract.

## Gotchas

The case-isolated generic runner invokes the Chromium project and its canonical onboarding setup in `studio/e2e/onboarding.setup.ts`. See `studio/playwright.config.ts`; each invocation uses disposable data and the free provider fixture.

The preserved IDs were reconstructed from executable case identities; the historical Planning inventory was unavailable. Closing an epic visit does not delete the epic or decide its suggestions. Count labels come from eligible backlog records and waiting suggestions, so fixed counts require controlled fixtures. Alt+[ / Alt+] cycles only while Plan is active. Open-visit persistence across app restart is unverified and is not promised by these cases. This entry records source/test evidence; it does not claim a fresh browser or desktop run.
