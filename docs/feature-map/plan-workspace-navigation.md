# Plan workspace navigation

Plan opens a project-wide planning workspace with a sprint collection, focused sprint visits and keyboard navigation alongside module tabs.

Surfaces: browser, desktop

## Sub-features

- `workspace-entry`: Open the correct sprint in full-width Plan and retain its epic visit when leaving and reopening (`workspace-create`, `agent-review`, `sprint-lifecycle`).
- `workspace-keyboard`: Home/End/arrows retain tab focus; Enter enters controls and Escape returns (`workspace-create`).

## How to get to it

Select a project, then activate **Plan** in **Project module tabs** (`workspace-tab-plan`). From a sprint card, **Plan** opens that sprint; **Review in Plan →** opens the sprint whose suggestions are ready. **Back to sprints** or **Done** returns to the Sprints collection. Plan does not require a selected module.

On the top strip, unmodified Left/Right wrap and activate enabled tabs; Home/End activate the first/last enabled tab without entering its body. Enter/Space activate Plan; on Changes they enter **Choose checkout**. These are direct tab handlers, not named keymap actions. Bare Escape closes an open Plan detail first; a subsequent Escape leaves Plan and focuses its tab. The keymap action `plan` (default N) opens a separate module-scoped, taskless agent planning flow that remains available with Roadmap OFF; see [Agent launch — agent-launch-plan](agent-launch.md) for its folder/prompt/picker sequence and coverage limits, and [Keyboard navigation and shortcuts](keyboard-navigation-and-shortcuts.md) for shortcut routing.

## Prerequisites

Use a selected project and a Roadmap-enabled build. `TICKETRY_ROADMAP_ENABLED` is resolved at build time into `__TICKETRY_ROADMAP_ENABLED__`; changing runtime settings or the URL cannot enable a compiled-off app. With Roadmap off, the Plan tab, Sprints collection, sprint Plan view, goal editor, discovery controls and lifecycle dialogs are absent; ordinary module workspaces remain. A planned sprint is needed for a focused visit; an empty project can still open the collection. See [Planner service](../planner-service.md) for the underlying planning contracts.

This build gate applies to the sprint workspace. The independent [N-key agent Plan flow](agent-launch.md) requires a selected project and module and remains available in a compiled-off build; it does not require a sprint or selected work item.

## Expected behavior

- Plan precedes Changes and module tabs and occupies the full work area while keeping the ordinary module workspace mounted and its saved split intact. Switching to Changes or a module leaves Plan. The `overhaul-453`–`overhaul-456` cases in `studio/src/test/overhaulWorkspaceSurfacesAcceptance.test.tsx` cover these paths.
- Activating the Plan tab chooses the first planned sprint by canonical sprint sequence; when there is none, it shows Sprints. A card entry selects its explicit sprint. `studio/src/features/sprints/planWorkspaceState.ts` and `studio/src/features/sprints/SprintsWorkspace.tsx` own selection and deferred selection while the graph loads.
- Back/Done closes the focused sprint without discarding its remembered epic tabs. Reopening that sprint keeps the visit, including the empty visit after closing its final epic. Leaving Plan restores its original module/Story selection when still valid; stale selection falls back safely. Visit retention is client state, not a promise of navigation restoration after restart. Source: `studio/src/features/sprints/planWorkspaceState.ts`; the same-session empty revisit is asserted in `workspace-create`.
- Opening a Story shows **Selected ticket**; Escape closes it before leaving Plan. While loading or when no sprint can be found, the focused view displays **Loading Plan…**, **Sprint not found.**, or a read-error alert rather than an editable plan. Sprints similarly reports loading/no-data/error state. Source: `studio/src/features/sprints/planning/PlanSprintView.tsx` and `studio/src/features/sprints/SprintsView.tsx`.
- Arrow/Home/End activation keeps focus on the top strip, including after asynchronous Changes rendering. `workspace-create` checks that Enter/Space then move focus into Changes controls and that Escape from Plan returns to its tab. A running suggestion agent continues while the user leaves and reopens Plan in `agent-review`.

## Verifying it

Browser suite: `studio/e2e/features/plan-workspace-navigation.spec.ts`.

Run `bun run --cwd studio test:e2e:feature plan-workspace-navigation`. Each case owns a fresh browser profile and canonical onboarding. Cases drive production browser controls, inject only network failures, and read public GraphQL or reload for persisted writes. The generic runner's run summary records passing evidence; a source citation alone is not passing proof.

Supplementary browser provenance remains in `studio/e2e/planning-module-manual.spec.ts` and `studio/e2e/planning-module-recovery.spec.ts`; those legacy files stay unchanged until the final migration ticket. Their cross-feature cases do not fill this entry's cells.

Supplementary Roadmap-off coverage is `studio/src/test/overhaulRoadmapOffAcceptance.test.tsx` via `bun run --cwd studio test:roadmap-off`. Browser screenshots cannot prove native rendering or paid-model behavior.

Supplementary focus and workspace acceptance: `studio/src/test/overhaulWorkspaceSurfacesAcceptance.test.tsx`.

## End-to-end suite

Suite: studio/e2e/features/plan-workspace-navigation.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| workspace-entry | @case-workspace-create, @case-workspace-review-entry | @case-workspace-create | @case-workspace-empty-read-recovery | @case-workspace-empty-read-recovery | @case-workspace-create, @case-workspace-empty-read-recovery, @case-workspace-review-entry | n/a: Plan visits are session navigation; saved Story reload is covered separately |
| workspace-keyboard | @case-workspace-create | @case-workspace-create | n/a: tab focus and arrow routing perform no server writes | @case-workspace-empty-read-recovery | @case-workspace-create, @case-workspace-empty-read-recovery | n/a: focus and tab activation are session navigation |

## Relevant code

- `studio/src/app/shell/ticket-workspace/WorkspaceTabs.tsx` and `studio/src/app/shell/ticket-workspace/useWorkspaceTabNavigation.ts`: surface entry, activation and roving focus.
- `studio/src/app/shell/StudioLayout.tsx`: full-width Plan and retained module workspace.
- `studio/src/features/sprints/planWorkspaceState.ts`, `studio/src/features/sprints/SprintsWorkspace.tsx` and `studio/src/features/sprints/SprintsView.tsx`: project/sprint selection, origin restoration and collection rendering.
- `studio/src/features/sprints/planning/PlanSprintView.tsx`, `studio/src/features/sprints/planning/PlanHeader.tsx` and `studio/src/features/sprints/planning/planKeyboardNavigation.ts`: focused visit, return controls and Escape routing.
- `studio/src/features/sprints/suggestions/SuggestionAgentBox.tsx`: explicit review entry.
- `studio/src/app/navigation/keymapBindings.ts`, `studio/src/shared/config/roadmapAvailability.ts`, `studio/scripts/roadmap-build-policy.mjs` and `studio/vite.config.ts`: separate agent prompt action and build-time gate.

## Gotchas

The case-isolated generic runner invokes the Chromium project and its canonical onboarding setup in `studio/e2e/onboarding.setup.ts`. See `studio/playwright.config.ts`; each invocation uses disposable data and the free provider fixture.

- The top-level tab is **Plan**; **Sprints** is the collection heading, not a second top-level workspace tab. Plan tab re-entry chooses the first planned sprint, so tests with other fixture sprints must use the intended card to select a particular sprint.
- Dialogs and inline inputs may consume Escape before workspace routing. Test actual retained focus rather than repeatedly refocusing a locator, which can hide focus theft.
- Inspect wide and narrow browser screenshots for control visibility, focus and overflow. Their filenames may say desktop, but browser evidence does not prove native Tauri/libghostty rendering, native terminal retention or paid-provider behavior. Installed-desktop navigation remains unverified here.
- Stable identifiers were reconstructed from executable case identities in the recovered Planning inventory; the historical original map was unavailable. Do not infer broader historical coverage from these IDs.
