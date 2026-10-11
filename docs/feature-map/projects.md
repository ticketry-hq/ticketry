# Projects

Studio opens the installation's default project automatically, while retained GraphQL lifecycle contracts support project records without a reachable add-project screen or project switcher.

Surfaces: browser, desktop

## Sub-features

- `projects-add-record`: Project creation provisions an independent workflow catalogue through the retained GraphQL contract; the current shell exposes no entry to the retained add-project form.
- `projects-default-resolution`: Startup prefers CDN, accepts legacy CODING, and creates Coding only when neither exists.
- `projects-lifecycle`: Identity-bound updates change name/description without changing the key.
- `projects-delete-record`: Deletion attempts transactional aggregate teardown; the migrated case retains the full cascade assertion.
- `projects-selection`: Startup selects the resolved project; internal project changes invalidate previous module and task navigation.

## How to get to it

- Launch Studio using the index's isolated browser or desktop profile. Startup resolves the installation project without a chooser; follow [Startup and service health](startup-and-service-health.md) for the gate and recovery controls.
- No production control or keymap action/default chord opens **Add project**, project rename/delete or a project-switching menu in the current shell. The retained `add-project` modal has **Name**, **Key**, **Create**, **Cancel** and modal confirm/close (Enter/Escape), but no current caller was found that opens it. Do not substitute removed project views or a test helper for a user entry point. Project creation normally occurs during installation/default resolution.
- To verify retained lifecycle behavior, use the existing public GraphQL tests below against disposable data. Their `create_project`, `update_project` and `delete_project` operations are service contracts, not UI controls. Module switching belongs to [Module tabs](module-tabs.md).

## Prerequisites

Normal startup requires the canonical local service. Use a fresh disposable profile to observe missing-default recovery, and fixture projects with unique three-letter keys for lifecycle checks. Never delete or rename the live installation project. Backend lifecycle coverage does not require a linked module folder or a paid provider.

## Expected behavior

- Default resolution selects an existing CDN before a legacy CODING project, irrespective of other project-list positions. With neither, it requests a project named Coding with slug CDN. If creation fails, it refreshes once to adopt a row another attempt may have created; without a matching row it reports failure to bootstrap. A TypeError produces the unavailable outcome; other bootstrap exceptions produce provisioning/retry. Sources: `studio/src/features/studio/lib/defaultProject.ts` and `studio/src/app/startup/bootstrapStudio.ts`.
- Creation uppercases the supplied key, requires exactly three ASCII letters and a valid nonblank name, refuses a duplicate key, and seeds the project's own default states, issue types, transitions and launch bindings in the same transaction. New projects created through this contract have onboarding_required false; installation provisioning has its own first-run rules. Source: `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/catalog.rs`.
- Update binds a project ID and accepts name/description; it does not change the slug. Successful frontend writes update Apollo's project rows. Failed store-level create/update calls return null and show an error toast; there is no reachable current project form whose cancel or retained-input behavior can be exercised.
- Deletion removes the project's blocker edges, issues, workflow transitions, launch bindings, issue types and states before deleting the project inside one transaction (`commands/project_delete.rs`). Frontend cache eviction occurs only after success; failure shows an error and requests no redirect. On selected-project success, the retained store clears bulk selection and returns a surviving project ID or null to its caller.
- Project selection clears module/task selection, reads that project's modules and restores a remembered visible linked module when available. Async completion from an older project visit is ignored. There is no human-facing project chooser or persisted recent-project menu; restarting resolves the installation default again. Module remembrance and tab visibility are separate state.

## Verifying it

The feature suite below now drives browser startup and breadcrumbs plus retained public GraphQL lifecycle contracts. Run outcomes and immutable evidence are recorded in the CODING-2713 handoff; supplementary coverage is distinct by seam:

- Default startup/remembered-module behavior: `studio/src/test/overhaulStartupAcceptance.test.tsx`; run `bun run --cwd studio test src/test/overhaulStartupAcceptance.test.tsx`. It drives bootstrap with mocked service/runtime data; inspect the selected project/module and outcome rather than treating this as installed-app evidence.
- Public GraphQL creation/catalogue isolation and invalid keys: `studio/e2e/project-lifecycle.spec.ts`, cases **provisions the reviewed catalogue when a project is created** and **refuses a project key that is not exactly three letters**; run `bun run --cwd studio test:e2e e2e/project-lifecycle.spec.ts --grep 'provisions the reviewed catalogue|refuses a project key'`. Observe uppercase ELC, distinct state IDs and type start states through authoritative reads; rejected keys leave no created project. These are request-level checks, not form automation.
- Real-schema deletion: `studio/src-tauri/tests/project_aggregate_delete.rs` installs the recorded Django schema plus the final migration chain with foreign keys enforced, deletes a provisioned project with a module and a migrated project with nested work and blocker edges through public `DeleteWorkTrackerProject`, and proves rollback by refusing the final Project row delete; run `cargo test --manifest-path studio/src-tauri/Cargo.toml --test project_aggregate_delete`. The browser case **deletes a project and cascades its whole aggregate** runs unannotated in both `e2e/features/projects.spec.ts` and `e2e/project-lifecycle.spec.ts`.
- A simplified schema/foreign-key fixture covers ordered deletion and rollback in `studio/src-tauri/tests/work_management_schema/project_aggregate_delete.rs`; run `cargo test --manifest-path studio/src-tauri/Cargo.toml --test work_management_schema_contract ordered_project_delete_rolls_back_and_cleans_references_atomically`. It checks rollback after injected failure and cleanup after removing the trigger on simplified tables; the real-schema test above covers the production migration schema.
- Direct project-selection visit guard: `studio/src/test/overhaulSprintModuleProjectGuardAcceptance.test.tsx` (`overhaul-499`) ignores late startup selection and errors after leaving a project; run `bun run --cwd studio test src/test/overhaulSprintModuleProjectGuardAcceptance.test.tsx`.
- Stale project-visit writes/navigation: `studio/src/test/overhaulModuleManagerWritesAcceptance.test.tsx` (`overhaul-619`) and `studio/src/test/overhaulModuleManagerCreationAcceptance.test.tsx` (`overhaul-627`); run `bun run --cwd studio test src/test/overhaulModuleManagerWritesAcceptance.test.tsx src/test/overhaulModuleManagerCreationAcceptance.test.tsx`. These invoke retained selection seams, not a project-switching UI.
- Add-project UI, project rename/cancel forms and human project switching have no automated production-path coverage because those surfaces are absent. The default resolver's concurrent-create recovery and retained project-update/delete redirect paths are source-grounded; no dedicated automated case for those paths was found. Browser onboarding setup can block request specs before they run; see Gotchas.

## End-to-end suite

Suite: studio/e2e/features/projects.spec.ts

The retained lifecycle contracts have no shell form; their migrated cases use public GraphQL against the browser runner's disposable profile. The rename case keeps its exact title and assertions and uses the onboarded Story as its breadcrumb fixture. The cascade case removes the legacy expected-failure annotation so a real defect cannot count as verified.

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| projects-add-record | @case-projects-provision-catalogue | n/a: no reachable creation form or cancellable API operation | @case-projects-invalid-key @case-projects-create-recovery | @case-projects-create-recovery | @case-projects-provision-catalogue | @case-projects-provision-catalogue @case-projects-create-recovery |
| projects-default-resolution | @case-projects-default-selection | n/a: startup resolution has no cancellation action | @case-projects-resolution-retry | manual: missing-default installation requires public deletion which fails; legacy CODING cannot be created through the three-letter-key contract; no successful responses are mocked | @case-projects-default-selection @case-projects-resolution-retry | @case-projects-default-selection |
| projects-lifecycle | @case-projects-rename-breadcrumb @case-projects-update-recovery | n/a: no reachable rename form or cancellable API operation | @case-projects-update-recovery | @case-projects-update-recovery | @case-projects-rename-breadcrumb | @case-projects-rename-breadcrumb @case-projects-update-recovery |
| projects-delete-record | @case-projects-delete-aggregate | n/a: no reachable delete confirmation or cancellable API operation | @case-projects-delete-recovery | @case-projects-delete-aggregate | @case-projects-delete-aggregate | @case-projects-delete-aggregate |
| projects-selection | @case-projects-default-selection | n/a: automatic selection has no cancellation action | @case-projects-resolution-retry | n/a: installation bootstrap resolves a default project before the shell opens | @case-projects-default-selection | @case-projects-default-selection |

Internal project-switch visit guards remain supplementary Vitest evidence: there is no production project chooser to drive in the browser.

## Relevant code

- `studio/e2e/features/projects.spec.ts`: browser startup, breadcrumbs and retained public lifecycle contract suite.

- `studio/src/features/projects`: retained record lifecycle, selection, project-open reads and Apollo cache ownership; module presentation behavior is expanded in the other entries in this group.
- `studio/src/features/studio/modals/AddProject.tsx` and `studio/src/app/modal/ModalHost.tsx`: retained modal registration, without a reachable current open action.
- `studio/src/features/studio/lib/defaultProject.ts` and `studio/src/app/startup/bootstrapStudio.ts`: default identity resolution and startup selection.
- `studio/src/features/projects/operations/projects.graphql`, `studio/src/features/projects/mutationTransport.ts`, `studio/src/features/projects/queries/index.ts`, and `studio/src/features/projects/store.ts`: public operations, cache adoption and selected-project visit guards.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/project` and `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/catalog.rs`: backend project write contracts and validation.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/default_project_catalog.rs`: reviewed workflow provisioning.
- Reuse the [context map](../../CONTEXT-MAP.md), [Studio language](../../studio/CONTEXT.md), and [Work Management language](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/CONTEXT.md) for ownership and vocabulary.

## Gotchas

- The retired project switcher and project views are deliberately absent from `studio/src/features/projects/index.ts`. Mapping an API or internal selection capability does not make it reachable through a current UI control.
- CODING-2753 repaired production deletion's catalogue foreign-key refusal (`worktracker_storage_failed`). Attachments, agent runs, automation attempts, graph runs and launched-task records still reference Work Items without a cascade; deleting a project that owns them is refused and rolled back.
- CODING-2708 recorded the stale Modules-pane onboarding setup failure. The current setup uses the Module Manager and passes before this suite; legacy files remain unchanged until CODING-2720.
- The existing [context map](../../CONTEXT-MAP.md) contains old path/ownership descriptions; linked current crate paths above take precedence. No default-project, lifecycle or project-switching behavior is asserted solely from those older references.
