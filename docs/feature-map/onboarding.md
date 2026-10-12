# Onboarding

First-run onboarding offers optional provider setup, guides real module and Story creation, and explains the saved Story's next step without launching an agent.

Surfaces: browser, desktop
Editions: pocock, core

## Sub-features

- `onboarding-welcome`: Replace the shell while first-run acknowledgement is pending and introduce planning without a provider subscription.
- `onboarding-provider-choice`: Save zero or more active providers and an appropriate launch default before starting the tour.
- `onboarding-first-module`: Teach the module name and working directory through the real Module Manager creation form.
- `onboarding-story-capture`: Guide entry of the first Story in the real idea field without creating the example or launching work.
- `onboarding-coach-marks`: Anchor non-modal teaching cards to actual controls, keeping them visible and returning focus with Escape.
- `onboarding-completion`: Acknowledge the tour's project on Skip tour or Finish tour, preserving created content and selection through reload. A project without a Story type ends at Your first module is ready.
- `onboarding-story-workflow-guide`: Show the saved Story's live, read-only workflow guide from handoff or Details.
- `onboarding-core-module-finish` (core): When the tour's project has no task-level Story type, finish the tour from Your first module is ready after the first module, without Story capture, handoff or the Story workflow guide.
- `onboarding-story-handoff`: Explain planning, provider configuration and current-stage launch binding separately from actual launch readiness.

## How to get to it

Start with isolated first-run data whose installation project has onboarding_required enabled. Welcome to Ticketry contains Your agents, the I use codex / I use claude checkboxes and Get started. No initial Skip control bypasses required setup; leaving subscriptions unchecked is a supported choice.

After Get started, follow Add your first module: open the footer's Open Module Manager control, then New module and the Create module form. The global toggle-module-manager action defaults to Meta+Shift+M when the shell is mounted. Fill Module name, use Next to see Choose where work runs, and use Got it to dismiss that teaching card. Fill Module folder with an absolute working-directory path, then Create module. The modal.confirm action defaults to Enter in creation inputs. Desktop offers Pick Folder beside the path field; browser users type or select a recent path.

At Create your first story, type your own idea into the real field and press Enter. The resulting Story is selected at Your first story is ready. Open Story workflow guide from that handoff or the saved Story's Details toolbar; use Close or modal.close (Escape) to return. Finish tour completes handoff; Skip tour is available at Story creation. There is no Skip tour button during the first-module teaching steps.

## Prerequisites

The [index](README.md) supplies runtime isolation rules; this entry deliberately exercises the first-run exception to its completed-onboarding baseline. Services and bootstrap must be ready. Provider catalog and capability reads must succeed before Get started can save the choice; zero providers requires no paid provider or executable.

Module creation needs a valid folder and module issue type. Provider directory-trust preparation and native folder selection apply only on desktop. Workflow help needs a saved Story selected with its project/state/type available; scratch and module-only selections have no guide control.

## Expected behavior

- The installation project's persisted flag owns whether onboarding is required. An empty project result means first run; an unreadable result is not treated as a first run. Without a recognized installation slug, the oldest project owns the answer: `WorkTrackerOnboarding` returns projects in creation order (CODING-2915). Get started saves the provider catalog and resolves/selects the installation project before the tour starts. It does not ask the user to name a project.
- Zero providers saves an empty active list and no global default. One selected provider gets an automatic provider default. With two or more, the user must choose an explicit default. Loading, catalog/capability errors, invalid configuration or saving disable continuation; errors appear as alerts and failed saves can be retried. Existing Codex profiles are retained.
- Module-name and CWD cards teach different concepts: the display name need not match the folder, and multiple modules can share a CWD. Missing/invalid CWD prevents successful creation. Cancel restores the first-module card. If the module is created but saving its folder fails, Save folder retries the link without creating a duplicate module; advancement waits for a saved valid link. Desktop trust refusal cancels before creation, and native setup failure is retryable.
- Module creation advances to Story capture only when the tour's project has a task-level Story type. Without one — a fresh core-edition project, which seeds only `Module` (CODING-2860) — the tour ends at **Your first module is ready**, whose only control is **Finish tour**; Story capture, handoff and the Story workflow guide never render (CODING-2861). Finish tour acknowledges onboarding exactly as below, so the tour does not return on reload. The check reads the cached project catalogue; an unread catalogue keeps the full tour. Pocock's reviewed catalogue always has Story, so its tour is unchanged. Ending after the module rather than hiding onboarding in core awaits owner confirmation. The example is explanatory text, not a pre-created Story. Saving the user's Story advances to handoff and selects it; neither capture nor viewing the guide starts an agent. The handoff recommends Details for desired result and completion criteria. Zero providers gets planning-only guidance; active providers still require a stage binding and executable/login/profile/backend checks.
- Coach marks are accessible non-modal dialogs, do not trap focus and highlight the real anchor. They reposition on resize/scroll or DOM changes, clamp to the viewport, and fall back into document flow when an anchor is missing. Escape returns focus to the anchor; it does not acknowledge onboarding.
- Skip tour and Finish tour acknowledge the specific project that started the tour, then reset its temporary state. Busy actions are disabled. An acknowledgement failure leaves the current card, created content and selected Story usable, exposes onboarding-step-error and permits retry. Completed acknowledgement survives reload; a half-finished tour does not resume its previous step after refresh.
- The Story workflow guide is read-only and reflects configured stages, outgoing transitions, instructions, current state, bindings and entry auto-start. Custom stage names and empty instructions stay explicit. Loading/error states retain generic planning help and offer retry rather than inventing stages. Close/Escape restores focus to the exact invoking trigger if it survives (never a retained hidden copy), and an engaged Details surface does not take that focus back when the modal's occlusion ends; deselecting, deleting or retyping the Story dismisses stale help. An optional guide load failure does not prevent Finish tour.

## Verifying it

`studio/e2e/features/onboarding.spec.ts` independently proves first-run onboarding through the canonical browser and public GraphQL boundary.

The real GraphQL contention regression `studio/src-tauri/crates/surfaces/ticketry-graphql-schema/tests/onboarding_write_contention.rs` verifies that acknowledgement waits behind a competing SQLite writer, updates only the named project, and preserves the other project's pending flag and concurrent write. Run `cargo +1.95.0 test --locked --manifest-path studio/src-tauri/Cargo.toml -p ticketry-graphql-schema --test onboarding_write_contention`. This backend check supplements browser proof.

`studio/src-tauri/crates/surfaces/ticketry-graphql-schema/tests/onboarding_project_order.rs` executes the authored `WorkTrackerOnboarding` read over projects whose creation order is the reverse of their ID order and requires the oldest first. Run `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-graphql-schema --test onboarding_project_order`.

Observe onboarding-welcome, onboarding-module-name-next, onboarding-module-folder-done, onboarding-skip-tour, onboarding-story-workflow-guide, onboarding-finish and onboarding-step-error. Use accessible names for the Your agents heading, provider checkboxes, Get started, Module name, Module folder, Create module, Save folder, the non-modal teaching dialogs and the Story workflow guide dialog. Confirm the new Story is selected in the tree and Details; confirm no launch was triggered by capture or help. Read back the provider catalog and WorkTrackerOnboarding project flag, then reload to check content, selection and completed acknowledgement.

Existing coverage and narrow commands from the repository root:

| Coverage | Evidence | Narrow command |
| --- | --- | --- |
| `studio/src/test/OnboardingGate.test.tsx`; `studio/src/test/onboardingStore.test.ts` | Welcome gating, active-tour shell handoff, installation-project selection, empty versus unreadable state and project-bound acknowledgement. | `bun run --cwd studio test src/test/OnboardingGate.test.tsx src/test/onboardingStore.test.ts` |
| `studio/src/test/overhaulOnboardingAcceptance.test.tsx` | overhaul-26 waits for installation-project selection before starting a zero-provider tour. | `bun run --cwd studio test src/test/overhaulOnboardingAcceptance.test.tsx` |
| `studio/src/test/overhaulProviderSettingsAcceptance.test.tsx` | Zero-provider continuation, pending/error catalog protection, single-provider defaults, multiple-provider validation and overhaul-17 fresh onboarding default save. | `bun run --cwd studio test src/test/overhaulProviderSettingsAcceptance.test.tsx` |
| `studio/src/test/overhaulOnboardingModuleAcceptance.test.tsx` | overhaul-28 and overhaul-29: project retry and real Module Manager setup; overhaul-29a/b/c: cancel, desktop picker and card placement; overhaul-125: required CWD; overhaul-295/296: trust refusal/native retry. | `bun run --cwd studio test src/test/overhaulOnboardingModuleAcceptance.test.tsx` |
| `studio/src/test/CoachMark.test.tsx` | Accessible non-modal behavior, Escape focus, resize/missing-anchor placement and narrow viewport clamping. | `bun run --cwd studio test src/test/CoachMark.test.tsx` |
| `studio/src/test/overhaulCoreOnboardingAcceptance.test.tsx` | CODING-2861: a core catalogue without Story offers Finish tour right after the first module, never renders Story capture/handoff/guide, persists acknowledgement (GraphQL read-back) and stays dismissed on remount. | `bun run --cwd studio test src/test/overhaulCoreOnboardingAcceptance.test.tsx` |
| `studio/src/test/overhaulOnboardingCompletionAcceptance.test.tsx` | overhaul-370/371: completion/reload and acknowledgement retry; overhaul-372: real capture; overhaul-386/389/390: handoff, optional help failure and binding guidance; overhaul-388: reopen guide after completion. | `bun run --cwd studio test src/test/overhaulOnboardingCompletionAcceptance.test.tsx` |
| `studio/src/test/overhaulStoryWorkflowGuideAcceptance.test.tsx` | overhaul-373–385: read-only behavior, configured/custom stages, focus, retries, revisions and stale-Story dismissal. | `bun run --cwd studio test src/test/overhaulStoryWorkflowGuideAcceptance.test.tsx` |
| `studio/src/test/overhaulZeroProviderPlanningAcceptance.test.tsx` | overhaul-363/364/366: interrupted-tour restart, planning without agents and recovery from refused launch through explicit settings/retry. | `bun run --cwd studio test src/test/overhaulZeroProviderPlanningAcceptance.test.tsx` |
| `studio/e2e/onboarding.setup.ts` | Authored browser setup walks provider/model/default selection, module name/CWD, Story capture and Finish tour, then reads back the catalog and acknowledgement. Its Module Manager entry path was migrated under CODING-2711/CODING-2643. | `bun run --cwd studio test:e2e --project setup` |
| `studio/scripts/desktop-agent-acceptance.mjs`; [desktop harness reference](../../studio/e2e-desktop/README.md) | Authored desktop scenario selects Codex, creates/trusts a module, then uses Skip tour before capturing its execution Story. It does not exercise Story handoff/Finish tour; its module entry is also stale. | `bun run --cwd studio test:e2e:desktop` |

The Playwright setup project is a dependency of ordinary browser suites and contains an onboarding journey. The listed Vitest cases drive components with substitutes for persistence/native services. The provider-save error rendering, DOM-mutation repositioning and explicit retyping-dismissal branch are grounded in source; this coverage inventory does not claim independent end-to-end proof of each branch.


## End-to-end suite

Suite: studio/e2e/features/onboarding.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| onboarding-welcome | @case-onboarding-provider-completion | n/a: required welcome has no cancel control | @case-onboarding-provider-recovery | @case-onboarding-zero-provider-skip | @case-onboarding-provider-completion | @case-onboarding-module-cancel-reload |
| onboarding-provider-choice | @case-onboarding-provider-completion | @case-onboarding-provider-completion | @case-onboarding-provider-recovery | @case-onboarding-zero-provider-skip | @case-onboarding-provider-completion | @case-onboarding-provider-completion |
| onboarding-first-module | @case-onboarding-provider-completion | @case-onboarding-module-cancel-reload | @case-onboarding-content-recovery | @case-onboarding-content-recovery | @case-onboarding-module-cancel-reload, @case-onboarding-content-recovery | @case-onboarding-module-cancel-reload |
| onboarding-story-capture | @case-onboarding-provider-completion | @case-onboarding-zero-provider-skip | @case-onboarding-content-recovery | @case-onboarding-zero-provider-skip | @case-onboarding-provider-completion | @case-onboarding-provider-completion |
| onboarding-coach-marks | @case-onboarding-provider-completion | @case-onboarding-module-cancel-reload | n/a: read-only coach marks have no failure operation | n/a: teaching cards have no empty data state | @case-onboarding-module-cancel-reload | @case-onboarding-module-cancel-reload |
| onboarding-completion | @case-onboarding-provider-completion | @case-onboarding-zero-provider-skip | @case-onboarding-content-recovery | @case-onboarding-zero-provider-skip | @case-onboarding-provider-completion, @case-onboarding-zero-provider-skip | @case-onboarding-provider-completion |
| onboarding-story-workflow-guide | @case-onboarding-provider-completion | @case-onboarding-provider-completion | @case-onboarding-content-recovery | @case-onboarding-content-recovery | @case-onboarding-provider-completion | @case-onboarding-provider-completion |
| onboarding-story-handoff | @case-onboarding-provider-completion | @case-onboarding-provider-completion | @case-onboarding-content-recovery | @case-onboarding-content-recovery | @case-onboarding-provider-completion | @case-onboarding-provider-completion |
| onboarding-core-module-finish | @case-onboarding-core-module-finish | n/a: the module-ready card offers no cancel or Skip tour control | @case-onboarding-zero-provider-skip | @case-onboarding-core-module-finish | @case-onboarding-core-module-finish | @case-onboarding-core-module-finish |

The suite uses `profile: "first-run"` and case isolation. Each case starts in a fresh, unacknowledged browser profile; the other suites retain `onboarding.setup.ts` as their onboarded baseline. Network failure cases abort only named GraphQL operations and retry the real user action. Native folder selection, provider trust and native setup remain desktop-only. The startup project-open operation loads the provider catalog before Welcome; its failure is a startup bootstrap failure rather than an independent Welcome catalog error. Provider writes are independently failed and retried here; startup read recovery is proven in the startup suite. CODING-2643 changed the module entry to Open Module Manager → New module → Create module. Under `TICKETRY_EDITION=core` the provisioned project has no Story type, so `@case-onboarding-provider-completion`, `@case-onboarding-zero-provider-skip` and `@case-onboarding-content-recovery` take the module-ready path: completion, Finish-tour acknowledgement failure/retry and module-folder recovery are proven there, while their Story setup, capture, handoff and guide steps run only in Pocock. `@case-onboarding-core-module-finish` (core only) proves the module-ready card, absent Story steps, GraphQL acknowledgement read-back and reload.

## Relevant code

- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/project/views/acknowledge_onboarding/mod.rs`: identity-bound restricted acknowledgement and first-statement writer reservation.
- `studio/src/app/onboarding`: Welcome, provider step, onboarding gate/state, tour, coach marks and Story handoff guidance.
- `studio/src/features/onboarding`: The single Apollo-owned, temporary tour row and its step transitions; `studio/src/features/onboarding/storyCapture.ts` decides whether the project's catalogue lets the tour continue to Story capture.
- `studio/src/app/modal/StoryWorkflowGuideModal.tsx`: Guide modal and focus return to the exact invoking trigger.
- `studio/src/app/shell/ticket-workspace/selected-ticket/details/StoryWorkflowGuideAction.tsx`: Saved-Story toolbar entry.
- `studio/src/features/workflows/StoryWorkflowGuideDialog.tsx` and `studio/src/features/workflows/StoryWorkflowGuideStages.tsx`: Live read-only guide content.
- `studio/src/features/module-creation/ModuleCreationFields.tsx` and `studio/src/features/module-creation/useModuleCreation.ts`: Shared guided name/CWD inputs and creation/link/trust retry behavior.
- `studio/src/features/agents/terminal/ModuleFolderSelection.tsx`: Typed/recent paths and desktop-only folder picker.
- `studio/src/app/navigation/keymapBindings.ts`: Default Module Manager and modal action chords.

## Gotchas

- CODING-2752 fixed Details guide focus return after completed onboarding and reload. In Edit view, closing the modal ended occlusion, and the engaged Details surface re-requested focus over the restored trigger. A Details-surface focus request now leaves focus on any control already inside the surface. The guide also remembers its exact invoker rather than the first `[data-story-workflow-guide-toolbar]` match. `@case-onboarding-provider-completion` asserts the browser path; `studio/src/app/modal/StoryWorkflowGuideModal.test.tsx` covers retained earlier triggers for Close and Escape; `overhaul-824` covers the workspace focus seam.

- Pinned Seaolim `29f2417` opens restricted mutations with deferred transactions and exposes no transaction-mode option at this seam. A SQLite read-to-write upgrade can fail immediately even with the pool's five-second busy timeout. A zero-row SeaORM update reserves the writer before the acknowledgement reads its project; the non-null primary-key predicate changes no row. The assembled GraphQL contention regression above guards this narrow framework workaround until upstream supports immediate transactions.
- Pick Folder and provider trust/native setup prompts are desktop-only. Browser evidence cannot prove either; use typed CWD for its closest real path. Native tests cited here use substitutes, not a real OS picker or provider login.
- CODING-2708 recorded the old browser setup failure at pane-modules. CODING-2711 migrates that shared setup to the CODING-2643 Module Manager path; this first-run feature suite independently drives the current form. The desktop agent harness still needs its separate migration.
- The mounted onboarding acceptance tests share `studio/src/test/onboardingJourneyFixture.tsx`, a durable GraphQL boundary whose `core` catalogue has no states or Story type. Module-only test catalogues now end the tour at Your first module is ready, so tests that expect Story capture must seed a Story type.
- An interrupted tour restarts at welcome when acknowledgement is still pending; it does not replay the prior module/Story step. Already saved content remains. Do not mistake the welcome return for deleted work.
- Coach marks are non-modal; the Story workflow guide is a modal with focus containment. Some cards deliberately leave focus in the taught input, and the handoff card is portaled. Missing anchors use in-flow placement.
- A configured provider and a displayed Run item explanation do not prove runnable credentials or a successful paid-provider launch. The guide has no launch buttons.
- Planning/help coverage uses isolated fixtures and contains no live walkthrough. Real installed-app reload, native trust and paid-provider behavior remain unverified by this entry.
