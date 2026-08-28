# Final Rust versus main behavioral parity audit

Date: 2026-08-27  
Worktree: `/Users/karthik/merge_conflicts/coding/ticketry-rust-main-parity`  
Branch: `work/rust-main-parity`  
Rust HEAD: `e5c6ab5ce4e120d648379dde864f24f45827a7db`  
Merge-base: `aefbd1b56c2b8763430c96d7f4b5fd61669f54c0`  
Refreshed `origin/main`: `78201ef0005cca46ea798c78553fb37b54fc09c0`

## Result

The Rust branch has the important architectural replacement already: the desktop owns its services in process, database-backed APIs use SeaORM, Seaography, and GraphQL, Apollo owns frontend records, and Python, REST, OpenAPI, and generated SDK compatibility layers are gone. Those main changes must not be restored.

Behavioral parity is not complete. The remaining work is concentrated in five connected areas:

1. The product and data-model sequence represented by Django migrations 0044 through 0051 has not been carried through the Rust schema, adoption, generated GraphQL, and frontend. The dirty worktree has started 0048 and 0051 only.
2. Main's earlier single-project and typed `ModuleLink` decision is also absent. Rust still has `Workspace`, project selection, profiles, feature flags, recent-project state, and file-backed module links.
3. Native Ghostty paste, command-key routing, native module shortcuts, and `Cmd+Escape` state synchronization are missing.
4. Work-item activation, final AgentPicker presentation, PathFind filtering, workspace-tab ordering, module presentation, hidden tabs, picker, jump badges, and sidebar recovery are missing or partial.
5. Installed-artifact acceptance still assumes the Workspace-era schema, and the root package version remains `0.1.0`.

The smallest safe route is not to merge main. Port the behavior in the ordered list near the end of this note.

## Method and evidence boundary

I refreshed `origin/main`, then verified:

```text
git rev-parse origin/main
78201ef0005cca46ea798c78553fb37b54fc09c0

git merge-base HEAD origin/main
aefbd1b56c2b8763430c96d7f4b5fd61669f54c0
```

The audit used only Git objects in that range, source files, migrations, and tests in this worktree. Older aggregate notes were used only as search maps after the underlying claims were rechecked.

The comparison target was the dirty worktree, not just HEAD. During the audit, concurrent uncommitted work added or changed the workflow-color migration wiring and Spark fresh-install provisioning. Those files are therefore classified as in progress. No test result was available that would justify calling the dirty work complete.

## Commit topology

| Commit | Subject | Independent content |
| --- | --- | --- |
| `3a5f434a90696f40a4911e401a84db009cdfa4e7` | Harden repository governance and backend REST boundaries | Yes. Mixed product, native, migration, Django, REST, packaging, and documentation changes. |
| `602596a1ea0146a1d19aad20912bdd9d3b2f1dfe` | Harden terminal runtime ownership and agent launch isolation | Yes. Mixed runtime safety, launch prompt, migrations 0049 to 0051, and module/workspace UI changes. |
| `44a3c6e1aa78da7af765e8fa436e683335cff2ce` | Merge pull request #28 | No. Its tree equals second parent `602596a`; there is no merge-resolution diff. |
| `9d752d77b3da9766c3e4c79e32624cc66d860ddb` | Prepare Ticketry 0.2.0 release | Yes. Version changes, migration fixes, a work-item activation import correction, and release files. |
| `24c28f1e299ab15f7b1c9068c5f4efb45d6c4683` | Fix release acceptance for current schema | Yes. Installed-artifact acceptance only. |
| `041b78c45c3c3bde2437141dcdfbad8cc070e634` | Merge pull request #47 | No. Its tree equals second parent `24c28f1`; there is no independent merge resolution. |
| `e8239636b451a01c07779f5ab60f177d0ae71d64` | Add release download and product screenshots | Yes, documentation and binary screenshots only. |
| `78201ef0005cca46ea798c78553fb37b54fc09c0` | Merge pull request #48 | No. Its tree equals second parent `e8239636`; there is no independent merge resolution. |

The three merge commits add topology only. Later commits refine earlier work but do not cancel any product behavior from `3a5f434` or `602596a`.

## Migration and product-data sequence

The order matters. Main's migrations depend on one another exactly as `0044 -> 0045 -> 0046 -> 0047 -> 0048 -> 0049 -> 0050 -> 0051`. Rust cannot safely jump to the final columns because existing installations and imported Django generations need deterministic adoption.

### 0044, Codex 5.6 model catalog

Classification: **missing and must move**.

Source evidence:

- `3a5f434:backend/worktracker/migrations/0044_codex_5_6_model_catalog.py` adds `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` without deleting existing models.
- Sol and Terra allow `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; Luna allows all except `ultra`.
- `3a5f434:backend/worktracker/tests/test_migration_codex_5_6_model_catalog.py` proves creation, exact reasoning links, idempotence, and preservation of unrelated rows.

Current evidence:

- `studio/src-tauri/src/settings_persistence/provider_catalog_provisioning.rs` currently provisions `gpt-5.4`. Its dirty version also adds Spark, but it has no 5.6 models, no `ultra` reasoning row, and no model-specific 5.6 matrix.
- `studio/src-tauri/tests/installation_adoption.rs` tests fresh provisioning only. There is no existing-install reconciliation equivalent to 0044.
- `studio/src/features/workflows/LaunchDefaultPicker.tsx` and `ModelConfigurationPanel.tsx` already support model-specific reasoning data. The frontend mechanism is present; the catalog data and adoption path are not.

Required Rust areas:

- Provider-catalog provisioning and an idempotent existing-install migration under `studio/src-tauri/src/settings_persistence/`.
- Rust migration ledger or equivalent adoption evidence.
- Provider-catalog GraphQL reads and fresh plus upgrade tests.
- Acceptance coverage for each model and exact allowed reasoning set.

### 0045 and 0046, project-owned onboarding and Workspace removal

Classification: **missing and must move**.

Source evidence:

- `0045_project_onboarding_required.py` adds `Project.onboarding_required` and transfers a true Workspace value to the default `CDN` or `CODING` project, otherwise the oldest project.
- `0046_remove_workspace.py` makes project slugs globally unique, deterministically suffixes duplicates, removes `Project.workspace`, then deletes `Workspace`.
- `test_migration_project_onboarding.py`, `test_migration_remove_workspace.py`, and overhaul cases 131 to 133 cover value preservation, duplicate slugs, project-owned acknowledgement, default-project startup, and removal of profile and feature-config dependencies.

Current evidence:

- `studio/src-tauri/src/entities/work_management/workspace.rs` still owns `onboarding_required`.
- `studio/src-tauri/src/entities/work_management/project.rs` still has `workspace_id` and a Workspace relationship. It has no `onboarding_required`.
- `studio/src-tauri/src/work_management/commands/catalog.rs` creates projects under a Workspace and acknowledges onboarding by updating the first Workspace.
- `studio/src-tauri/src/installation_adoption/provisioning.rs` still seeds `worktracker_workspace`.
- `studio/src-tauri/src/installation_preflight/work_management_invariants/projects.rs`, `installation_classification/manifest.v1.json`, `installation_adoption/bridges.v1.json`, `installation_import/postgres-staging-schemas.v1.json`, `ownership_manifest.rs`, and many integration fixtures still require the Workspace shape.
- `studio/src/app/onboarding/onboardingStore.ts` still queries Workspace onboarding.
- `studio/src/app/startup/bootstrapStudio.ts` still loads profiles and feature flags, chooses a profile, restores recent projects, and can force the sidebar open.
- `studio/src/features/projects/store.ts` still persists recent-project behavior and supports project switching.

This is a large migration, not a field rename. It must update provisioning, adoption from every supported generation, preflight, ownership manifests, generated SeaORM and Seaography contracts, GraphQL operations, Apollo reads, onboarding, startup, MCP project discovery, tests, and installed-artifact fixtures.

Uncertainty: the current Rust branch may have intentionally kept multi-project UI while main chose one installation project. Nothing in the target range reverses main's decision. If the Rust product now intentionally differs, that needs an explicit product decision. Without one, this is a parity gap.

### Typed ModuleLink and retirement of profiles

Classification: **missing and must move**.

This is not numbered 0044 to 0051, but it is part of `3a5f434` and is a prerequisite for the single-project frontend behavior.

Source evidence:

- `backend/apps/settings_store/migrations/0003_module_link.py` creates one host-local `ModuleLink` per module with `id`, unique `module_id`, `local_path`, and timestamps.
- `docs/decisions/2026-08-19-typed-module-links-replace-profiles.md` removes profiles, Workspace configuration, feature flags, recent-project state, and legacy prompt files. It preserves only module-to-local-path data and imports valid legacy links best-effort before deleting the old files.
- `studio/src/features/module-links/queries.ts`, `mutations.ts`, and `path.ts` show the intended UI behavior. Main uses REST/TanStack here, which is obsolete; the data and behavior still apply.
- Overhaul cases 132, 134, and 144 prove startup independence, typed folder writes, and waiting for link data before prompting.

Current evidence:

- `studio/src-tauri/src/settings_persistence/profiles.rs` and `profile_graphql.rs` still expose profiles and module links as file-backed configuration.
- `studio/src/features/studio/stores/configStore.ts`, `bootstrapStudio.ts`, and `features/projects/store.ts` still depend on profiles, feature flags, recent projects, and per-project recent module maps.
- `studio/src/features/module-links/` does not exist.

Port this through a Rust-owned database table, SeaORM entity, generated Seaography read/write contract, caller-scoped GraphQL operations, Apollo cache updates, and one-time legacy file import. Do not recreate main's REST resource or TanStack cache.

### 0047, launch-binding entry skill

Classification: **missing and must move**.

Source evidence:

- `0047_launch_binding_entry_skill.py` adds nullable `LaunchBinding.entry_skill`.
- It seeds `grill-with-docs`, `to-spec`, and `to-tickets` only when each skill is already in that binding's `required_skills`.
- `backend/apps/terminals/entry_skill.py`, `test_migration_launch_binding_entry_skill.py`, and overhaul case 140 cover validation, persistence, clearing, and submitted entry-skill behavior.

Current evidence:

- `studio/src-tauri/src/entities/work_management/launch_binding.rs` has no `entry_skill`.
- `studio/src-tauri/resources/work-management/reviewed_defaults.json` has required-skill lists but no entry-skill map.
- `studio/src-tauri/src/work_management/graphql/workflow_configuration.rs`, `mcp/registry.rs`, `mcp/workflow_tools.rs`, frontend GraphQL operations, generated documents, and `LaunchConfigurationForm.tsx` have no entry-skill field.
- `studio/src-tauri/src/launch_planning/materialize.rs` validates skill availability but has no post-readiness entry-skill submission.

The data field, seed migration, update allowlist, MCP tool, UI picker, launch planning, and acceptance coverage all need to move together.

### 0048, workflow-state colors

Classification: **in progress**.

Source evidence:

- `0048_distinguish_workflow_state_colors.py` conditionally changes only exact former defaults: Ideas `#D12771 -> #60646C`, Grill `#60646C -> #FA4D56`, and Review `#D6409F -> #08BDBA`.
- Custom values and unrelated states are untouched. `test_migration_workflow_state_colors.py` and overhaul case 142 cover adoption and display.

Dirty-worktree evidence:

- `studio/src-tauri/resources/work-management/reviewed_defaults.json` has the new colors.
- New `studio/src-tauri/src/work_management/workflow_color_migration.rs` performs conditional updates and records its own ledger.
- Dirty `studio/src-tauri/src/graphql_foundation/mod.rs` invokes that migration on the supplied worktracker connection, and `installation_classification/rust_ledger.rs` recognizes its ledger.
- New `reviewed_default_colors.rs`, `workflow_color_adoption.rs`, and `overhaulWorkflowStateColorsAcceptance.test.tsx` provide fresh, adoption, GraphQL, and UI coverage.

Remaining proof:

- Run the new Rust tests and the numbered overhaul gate.
- Confirm the migration executes exactly once in both fresh and already-owned installation startup paths, without being called twice through nested initialization.
- Confirm the concurrent dirty files are committed as one coherent change. Until then, this is not complete.

### 0049, persisted workspace-tab order

Classification: **missing and must move**.

Source evidence:

- `0049_issue_workspace_tab_order.py` adds a JSON list to each issue.
- `test_workspace_tab_order_api.py` and overhaul cases 149, 153, 154, and 160 define full-identity persistence, restore after reload, document and terminal lifecycle ordering, optimistic drag, rollback, locking until load, and terminal cycling across unopened workspaces.

Current evidence:

- `studio/src-tauri/src/entities/work_management/issue.rs` has no workspace-tab-order field.
- `studio/src/features/workspace-tabs/` does not exist.
- `WorkspaceTabStrip.tsx`, `useWorkspaceTabPresentation.ts`, and `features/studio/lib/liveTerminalCycle.ts` still derive local ordering.
- No GraphQL operation carries the persisted identity list.

Use a model-shaped restricted WorkItem update field if the order belongs on WorkItem, consistent with `AGENTS.md`. Do not add a replacement per-field RPC unless the recorded operation-exception process justifies one.

### 0050, ModulePresentation and hidden module tabs

Classification: **missing and must move**.

Source evidence:

- `0050_module_presentation.py` creates one-to-one `ModulePresentation(module_id, rank, tab_hidden)`.
- It migrates existing manual module ranks only, then removes `Project.manual_module_order`.
- `9d752d77` fixes the migration to read and write through `schema_editor.connection.alias`. This is a real later correction, not release noise.
- Main tests cover migration, canonical ordering, hidden tabs, restore, sidebar lifecycle badges, picker, shortcuts, and archived-module exclusion. Overhaul cases 150 to 165 and 170 to 179 are the behavioral contract.

Current evidence:

- `studio/src-tauri/src/entities/work_management/project.rs` still has `manual_module_order`.
- `studio/src-tauri/src/entities/work_management/issue.rs` still stores module rank directly and there is no ModulePresentation entity.
- GraphQL operations and generated documents still select `manualModuleOrder`.
- `studio/src/features/projects/utilities/canonicalModuleOrder.ts` still adds agent-activity recency for automatic projects, and `moduleRecency.ts` still owns that overlay. Main removed this client-side ordering source.
- `studio/src/features/module-tabs/` does not exist. `ModulePicker`, `ModuleJumpBadge`, hidden-tab mutation/query code, restoration helpers, and lifecycle chicklets are absent.
- `ModulesPane.tsx`, `ModuleRow.tsx`, `ModuleTab.tsx`, `ModuleTabStrip.tsx`, `TicketWorkspace.tsx`, `StudioFooterActions.tsx`, startup, and client persistence still implement the pre-presentation behavior.

The Rust migration must use the exact active database connection and transaction passed into adoption. This is the Rust equivalent of main's multi-database fix. Do not open a default or second connection while copying manual ranks. Test fresh install, an automatic project with no presentation rows, a manual project with migrated ranks, idempotent reopen, and rollback.

### 0051, Codex Spark with model-default reasoning

Classification: **in progress, but incomplete**.

Source evidence:

- `0051_codex_5_3_model_catalog.py` idempotently adds `gpt-5.3-codex-spark` to Codex and assigns no reasoning-level rows.
- `9d752d77` strengthens its migration test by provisioning the provider at 0043, then running the entire 0044 to 0050 chain before 0051.
- Overhaul case 166 selects Spark, exposes only `Model default`, and saves `reasoning: null`.

Dirty-worktree evidence:

- `provider_catalog_provisioning.rs` now adds Spark with an empty reasoning list for fresh installations.
- `installation_adoption.rs` checks the fresh row and zero reasoning links.
- There is no existing-install reconciliation for Spark.
- The dirty fresh catalog still lacks the 0044 5.6 models, so it does not represent the final main catalog.
- `LaunchDefaultPicker.tsx` already supports an empty reasoning value but labels it `Provider default`, while main's model-specific behavior says `Model default`.
- No Spark acceptance case proves selection and a null saved value through the current GraphQL/Apollo path.

Finish 0044 first, then add an idempotent Spark adoption step that preserves existing models and settings. Test the complete sequence, not Spark in isolation.

## Runtime and native behavior

### Runtime ownership and cross-instance termination

Classification: **already present or behaviorally stronger**.

Source evidence:

- `602596a:backend/apps/terminals/runtime_ownership.py`, terminal launch changes, and agent termination tests refuse to terminate a run owned by another runtime.
- The MCP termination tool returns an explicit failure instead of claiming success.

Current evidence:

- `studio/src-tauri/src/terminal_cleanup/runtime.rs` distinguishes owned, foreign, and ambiguous observations.
- `terminal_cleanup/service.rs` refuses foreign or ambiguous identities before kill and records conflict effects.
- `work_management/mcp/run_termination.rs` returns a structured failure.
- `terminal_lifecycle/work.rs` persists and verifies the runtime namespace.

No port is needed for the safety invariant.

### MCP endpoint collision policy

Classification: **partially present by deliberate stronger policy**.

Main stops injecting MCP when this instance cannot bind it, then permits the provider process to launch without MCP. Rust clears the MCP URL and `terminal_lifecycle/work.rs::require_provider_control` blocks provider launches while still allowing shells. This is safer and consistent with Ticketry's run-scoped MCP authority.

One current inconsistency remains: `studio/src-tauri/src/desktop/user_notices.rs` labels the acknowledgement `Continue without MCP`, even though provider launch does not continue. Fix the notice. Do not copy main's launch-without-MCP policy unless product explicitly chooses degraded, tool-less agents.

### Provider-qualified required skills

Classification: **missing and must move**.

Source evidence:

- `602596a:backend/apps/terminals/agents/registry.py` gives Codex `$` and other providers `/` as invocation prefixes.
- `skills/preflight.py::skill_prompt_envelope` renders required skills with that prefix.
- `test_required_skill_launch.py` and `test_session_spawn.py` prove the envelope and entry-skill command use the selected provider's syntax.

Current evidence:

- `launch_planning/materialize.rs` checks that each required skill exists but does not add a provider-qualified prompt envelope.
- `launch_planning/provider.rs` has provider contracts but no invocation-prefix field.
- Entry-skill support is also absent, as described under 0047.

Add the prefix to the provider contract, render the prompt envelope once, and use the same prefix for submitted entry skills. Preserve durable skill IDs without `$` or `/` in the database.

### Ghostty clipboard and command-key routing

Classification: **missing and must move**.

Source evidence:

- `3a5f434:studio/src-tauri/native/libghostty_clipboard.m` binds clipboard requests to the originating surface, reads standard text from `NSPasteboard`, confirms paste, and invalidates ownership before surface free.
- `libghostty_view.m::performKeyEquivalent` asks `ghostty_surface_key_is_binding` before AppKit or the WebView consumes Command-key bindings.
- Overhaul cases 128, 135, 136, and 138 cover `Cmd++`, `Cmd+V`, focused-surface isolation, and safe teardown.

Current evidence:

- `studio/src-tauri/native/libghostty_runtime.m::runtime_read_clipboard` returns false and `runtime_confirm_clipboard` is empty.
- `studio/src-tauri/native/libghostty_view.m` has no `performKeyEquivalent`, no `ghostty_surface_key_is_binding`, and uses the view pointer directly as Ghostty userdata.
- The source acceptance files do not exist in the current worktree.

Port the Objective-C behavior against the pinned libghostty C API, retain the xterm fallback, and run native clipboard tests as well as acceptance tests.

Uncertainty: verify the pinned Rust branch libghostty revision exports the same binding-query and clipboard-completion symbols before copying signatures.

### Native module shortcuts and Cmd+Escape synchronization

Classification: **partially present and must finish**.

Current WebView module shortcuts already route through `sharedNavigation.ts::routeModulePositionNavigation`, but `studio/src-tauri/src/native_terminal/chords.rs` and `native/libghostty_view.m` recognize only panel-toggle and Settings. Main adds `Cmd+1` through `Cmd+0` while Ghostty is first responder and counts visible tabs only.

The current native view already hands AppKit focus back on `Cmd+Escape`, but it emits no event to clear React's `editViewBodyEngaged`. Main's overhaul case 169 adds that synchronization through `nativeTerminalKeyboard.ts` and `useNativeViewerHostEffects.ts`.

Move both behaviors through the existing narrow native-chord event contract. The native layer should report identities; React should keep ownership of module selection and edit-view state.

### Modal occlusion, focus ordering, drag-axis behavior, and native output activity

Classification: **already present or behaviorally equivalent**.

- Current `features/agents/terminal/internal/modalOcclusion.ts`, `nativeViewerPresentation.ts`, `terminalRegistry.ts`, and `useNativeViewerHostEffects.ts` already discard focus while a modal owns the foreground and converge hide/show races. Existing acceptance cases 117 to 124 cover this.
- Current `shared/dragDrop/useAxisDragAndDrop.ts` and `axisPlacement.ts` retain a promised seam outside cross-axis bounds, clear on Escape and document leave, and avoid duplicate commits. This matches main's case 130.
- Current `features/agents/terminal/internal/nativeOutputActivity.ts` and dirty acceptance case 169 report native output through the shared backend operation once and do not poll.
- Current folder validation already refuses a missing folder before module creation, covered by case 125.

Do not port main's older REST, WebSocket, or TanStack implementations for these behaviors.

### Python sidecar ownership and process supervision

Classification: **obsolete Django/REST/sidecar**.

Main's `backend/packaging/owner_liveness.py`, Python sidecar lifecycle, ASGI service ownership, Python terminal runtime, and generated SDK changes do not apply. The Rust desktop has in-process services and its own process, terminal, hook, and cleanup modules. Preserve Rust's process-group and tmux ownership behavior; do not recreate the sidecar.

## React behavior

### Live work-item activation

Classification: **missing and must move**.

Source evidence:

- `3a5f434:studio/src/app/navigation/workItemActivation.ts` selects the currently selected live task run or the newest live task run, restores a deliberately closed viewer from durable terminal metadata, otherwise launches the configured default agent once.
- It excludes plan, instant, shell, no-task, and ended runs; coalesces pending reveal and launch; preserves the prior tab on failure; and never steals terminal typing focus.
- `overhaulLiveWorkItemActivationAcceptance.test.tsx` covers Enter and exact Shift+Enter in both Stories layouts.
- `9d752d77` only moves `launchFailureMessage` behind the narrow `features/agents/terminal/appNavigation.ts` seam. It refines dependency direction and does not change behavior.

Current evidence:

- `studio/src/app/navigation/workItemActivation.ts` does not exist.
- `sharedNavigation.ts` still maps generic open-agent flows and Run Now, but has no live-run selection or reveal coordinator.
- The current acceptance suite has no live work-item activation case.

Port the coordinator onto current Apollo selectors, Rust GraphQL launch operations, and the current terminal-session store. Keep the later narrow import seam.

### Shift+Enter and Stories footer labels

Classification: **missing and must move**.

Main routes exact Shift+Enter on Stories directly to activated-provider choice while preserving the prompt-bearing route in other edit-view zones. It labels Enter `Open Terminal`, Shift+Enter `Choose Agent`, and Right Arrow `Expand / Dive`. Current `StudioFooterHints.tsx`, `sharedNavigation.ts`, and full-sidebar/edit-view navigation still expose the older generic routes and labels.

Implement with work-item activation so two separate launch coordinators do not emerge.

### AgentPicker presentation

Classification: **missing and must move**.

Main changes `AgentPicker.tsx` from list rows to compact wrapping buttons, reuses provider tones, keeps only the close button tabbable, marks keyboard selection with `aria-current`, and preserves one launch for pointer or keyboard choice. The source contract is `overhaulAgentPickerAppearanceAcceptance.test.tsx`.

Current `AgentPicker.tsx` still renders clickable `<li>` rows. `providerPresentation.ts` has reusable tone classes but no pane-ground parameter and AgentPicker does not use it.

### Hide internal PathFind type

Classification: **missing and must move**.

Source case 129 and `features/settings/visibleIssueTypes.ts` hide `is_pathfind` issue types from create and change choices while rendering an existing PathFind item as a read-only label. Current `IssueTypePicker.tsx` filters only `level === "task"`, so PathFind remains selectable even though the current GraphQL data already exposes `is_pathfind`.

This is a small, independent UI fix hidden among the larger backend changes.

### Server-owned module order and startup state

Classification: **partially present, superseded by the 0050 design**.

Rust already persists module rank and has robust optimistic reorder with stale-neighbor retry. That part should stay. It still overlays agent activity for automatic projects, tracks newly created modules, reads project ordering mode, retains recent projects, and restores modules through profiles. Main first removes those client ordering dependencies in `3a5f434`, then replaces `manual_module_order` with `ModulePresentation` in 0050.

Do not spend time separately polishing the current automatic/manual split. Move directly to the final 0050 model while preserving Rust's stronger stale-neighbor retry and Apollo cache behavior.

### Module presentation, hidden tabs, recovery, picker, and jump badges

Classification: **missing and must move**.

Source evidence is spread across `studio/src/features/module-tabs/`, `features/workspace-tabs/`, `ModuleTab.tsx`, `ModuleTabStrip.tsx`, `ModulesPane.tsx`, `ModuleRow.tsx`, `TicketWorkspace.tsx`, startup and client persistence, plus overhaul cases 149 to 179.

The final behavior includes:

- One canonical presentation order across sidebar, visible tabs, shortcuts, restoration, and picker.
- Hide any tab, including the last visible one.
- Right-neighbor then left-neighbor selection fallback.
- Hidden tabs stay hidden during agent activity and keep lifecycle badges in the sidebar.
- Sidebar selection and the searchable picker restore a hidden tab at its canonical position.
- The fixed plus opens the picker, whose first action opens existing module creation.
- `Cmd+1` through `Cmd+0` and held-Command badges count only visible tabs.
- Startup never restores a hidden remembered module.
- The Modules footer control remains a permanent recovery path and honors the stored visibility preference.
- A project with no modules is distinct from a project whose tabs are all hidden.

Current evidence:

- Neither `features/module-tabs/` nor `features/workspace-tabs/` exists.
- `StudioFooterActions.tsx` has Terminal and Settings only.
- `ModulesPane.tsx` has `+ Add Module`, not a restoration-aware picker.
- `clientStore.ts` and `persistence.ts` have no hidden-tab or jump-badge state.
- `bootstrapStudio.ts` can force sidebar visibility and does not know hidden presentation rows.

Implement this only after 0050 and typed ModuleLink are available through GraphQL and Apollo.

### Model-default reasoning

Classification: **partially present**.

The current generic UI and launch planner can carry `reasoning: null`, and `materialize.rs` omits a reasoning override when none is selected. Missing pieces are the final catalog, the `Model default` label for a model with no allowed levels, and acceptance proving Spark persists null without inventing options.

### Provider resume failure message and keyboard-reference copy

Classification: **partially present, low-risk follow-up**.

- `features/agents/terminal/internal/launchFailure.ts` already maps stable launch failures and is exported from `terminal/index.ts`, but the exact source case 145 for a rejected resume preserving its dormant chip is absent. Confirm or add that acceptance case when touching resume UI.
- Current Settings has a searchable keyboard reference, but its acceptance matrix lacks main's small case-122 refinement that descriptions remain readable and current. Recheck copy after the new Enter, Shift+Enter, module, and native shortcuts land.

## Release and installed-artifact behavior

### Installed-artifact acceptance

Classification: **partially present and must update last**.

Source evidence:

- `24c28f1:studio/scripts/installed-artifact-acceptance-driver.mjs` waits for a project rather than a Workspace after 0046.
- It creates real module and task fixtures when absent, includes `workspace_tab_order` in issue inserts, and includes `runtime_cleanup_pending` plus `output_sequence` in terminal inserts.
- Its tests cover empty issue tables and the revised SQL.

Current evidence:

- `studio/scripts/installed-artifact-acceptance-driver.mjs::launchReadyApp` and `failedUpdateRecoveryScenario` still query `worktracker_workspace`.
- Current Rust acceptance already has newer Rust-only process-shape checks, WAL checkpointing, and the current terminal columns. Those must be preserved.
- Main's raw SQL names the Django-era final schema. It cannot be copied verbatim before the Rust 0044 to 0051 equivalents settle.

Adapt the current Rust driver after all data migrations. Make fixtures through stable application contracts when practical; if raw SQL remains necessary, make it match the final generated Rust schema and prove clean install, upgrade, snapshot recovery, empty issue data, durable terminal relaunch, and Rust-only artifacts.

### Version 0.2.0

Classification: **partially present**.

Current `studio/package.json`, `studio/src-tauri/Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, and `studio/release/manifest.v1.json` already report `0.2.0`. Root `package.json` and the root entries in `package-lock.json` still report `0.1.0`.

Move the root version and lockfile update after the final behavior and installed-artifact gate. Backend and SDK version bumps from main are obsolete because those packages no longer ship.

### README, download link, screenshots, and release operations

Classification: **release/docs only**.

`e8239636` adds a release download link and three screenshots. Main's README still describes the retired Django and generated-SDK layout, so do not copy it. If release documentation is wanted, rewrite it for the Rust desktop and regenerate screenshots from the finished Rust UI. This is not a blocker for behavioral parity.

## Obsolete or non-product changes

The following range content should not move into the Rust app:

- Django models, migrations as executable Python, DRF serializers and views, REST URLs, ASGI behavior, OpenAPI generation, and generated Python or TypeScript SDKs.
- Python terminal runtime, Python run/execution services, Python MCP sidecar, sidecar packaging, owner-liveness helper, and sidecar tests.
- TanStack Query, REST client, WebSocket terminal, and old status transport code. Port only their tested user behavior through Apollo, GraphQL, TauRPC, and current Rust event streams.
- File-backed profile CRUD and compatibility APIs. Only the one-time data import into typed ModuleLink remains applicable.
- Generic issue templates, CONTRIBUTING, SECURITY, Dependabot, CodeQL, catalog docs, research notes, CI policy, and DRF override documentation. These are repository or documentation choices, not desktop behavioral parity.
- The three merge commits, which have no independent tree changes.

## Complete classification summary

| Behavior group | Classification |
| --- | --- |
| Rust-only service, GraphQL, Apollo, terminal ownership architecture | Already present and should remain authoritative |
| Runtime namespace checks and MCP termination failures | Already present or stronger |
| Modal occlusion, focus-race convergence, drag-axis handling, missing-folder validation, native output activity | Already present or equivalent |
| Workflow colors 0048 | In progress in dirty worktree |
| Spark fresh provisioning 0051 | In progress but incomplete |
| Codex 5.6 catalog 0044 | Missing and must move |
| Project onboarding and Workspace removal 0045 to 0046 | Missing and must move |
| Typed ModuleLink, profile and feature-flag retirement, single-project startup | Missing and must move |
| Entry skill 0047 | Missing and must move |
| Workspace-tab order 0049 | Missing and must move |
| ModulePresentation 0050 and multi-database correction | Missing and must move |
| Spark existing-install adoption and null-reasoning acceptance 0051 | Missing and must move |
| Provider-qualified required-skill prompts | Missing and must move |
| Ghostty paste and Command-key first refusal | Missing and must move |
| Native module shortcuts and Cmd+Escape React synchronization | Partially present and must finish |
| Work-item activation, Shift+Enter routing, Stories labels | Missing and must move |
| AgentPicker final presentation | Missing and must move |
| PathFind hidden from choices | Missing and must move |
| Module hidden tabs, recovery, picker, jump badges, footer control | Missing and must move |
| Model-default reasoning UI | Partially present |
| Installed-artifact final-schema acceptance | Partially present and must update last |
| Root 0.2.0 version | Partially present |
| Launch without MCP | Main differs; keep Rust fail-closed unless product decides otherwise |
| Django, REST, OpenAPI, generated SDK, Python sidecar | Obsolete |
| Release README, screenshots, generic governance and docs | Release/docs only |

## Minimal ordered move list

This is the smallest dependency-safe sequence. Several steps can have parallel frontend preparation, but they should integrate in this order.

1. **Define one Rust migration runner for post-0043 parity data.** It must use the supplied active worktracker connection, transact each step, record durable identities, reopen idempotently, and run for fresh, already-owned SQLite, supported Django SQLite adoption, and PostgreSQL import. Update classification, preflight, ownership manifests, provisioning, and test corpus as each schema step lands.
2. **Port 0044.** Reconcile the three Codex 5.6 models and exact reasoning matrices for fresh and existing installs. Add `ultra` without changing unrelated rows.
3. **Port typed ModuleLink, 0045, and 0046 as one product-model campaign.** Import valid legacy links, move onboarding to the default project, resolve duplicate slugs deterministically, remove Workspace, retire profiles and feature flags, pin Studio and MCP to the installation project, and preserve one frontend-only recent module value.
4. **Port 0047.** Add entry-skill data, seeds, GraphQL and MCP patches, UI selection, and provider-specific post-readiness submission.
5. **Finish 0048.** Complete and validate the dirty color work without overwriting custom colors.
6. **Port 0049.** Add server-owned workspace-tab order, generated GraphQL, Apollo persistence, restoration, drag, lifecycle updates, and live-terminal cycling.
7. **Port 0050 using the active connection.** Add ModulePresentation, copy only manual ranks, remove `manual_module_order`, and change every module consumer to presentation order. Preserve Rust's stale-neighbor reorder retry.
8. **Build the 0050-dependent UI.** Add hidden-tab behavior, sidebar lifecycle badges, restoration, footer recovery control, module picker, visible-only shortcuts, held-Command badges, startup rules, and no-module versus all-hidden states.
9. **Finish 0051 after 0044 to 0050.** Add Spark adoption for existing installs, retain all 5.6 models, expose no reasoning rows for Spark, label the empty selection `Model default`, and save null.
10. **Port provider-qualified required-skill prompts.** This can share the provider-prefix contract with entry-skill submission from step 4.
11. **Port work-item activation and AgentPicker behavior.** Add Enter reveal-or-launch, exact Shift+Enter choice, failure retry, footer labels, provider-tone buttons, and PathFind filtering.
12. **Port native Ghostty behavior.** Add per-surface clipboard ownership, paste completion, focused `performKeyEquivalent`, module-position chord reports, and Cmd+Escape body-disengage reporting. Run Objective-C native tests and keep xterm fallback coverage.
13. **Run final-schema installed-artifact acceptance.** Update readiness and recovery to projects, create valid final-schema module and task fixtures, preserve current Rust-only process checks, and test the whole adoption chain.
14. **Align root version and release material.** Set root package and lockfile to 0.2.0. Rewrite README or regenerate screenshots only if release documentation is in scope.

## Required completion evidence

Parity is not proven by schema compilation alone. The final implementation should show:

- Fresh-install and existing-install tests for every data step, including exact row preservation and repeated reopen.
- One full-chain test that starts from the current 0043-equivalent Rust/Django-adopted shape and reaches the 0051-equivalent leaf.
- A multi-connection or alternate-database test that fails if ModulePresentation migration code silently uses a default connection.
- Regenerated SeaORM and Seaography contracts with caller-specific GraphQL operations and no handwritten REST replacement.
- Apollo-only frontend state, with no second server-record snapshot.
- Numbered acceptance cases for every user-visible behavior moved from main.
- Native Objective-C clipboard and keyboard tests plus Rust chord mapping tests.
- `npm run test:overhaul --workspace @worktracker/studio`, the affected Rust tests, typecheck, build, and installed-artifact acceptance against the packaged app.

## Uncertainties that need explicit decisions

1. **Single-project versus current multi-project UI.** Main decisively removes Workspace and pins Studio to one project. Rust still exposes project CRUD and recent-project navigation. If this difference is intentional, record it as a product decision before dropping 0045, 0046, and the startup changes from parity scope.
2. **MCP-degraded launches.** Main launches agents without MCP after a collision. Rust blocks them. The Rust behavior better preserves task-scoped authority. Keep it unless product explicitly accepts agents that cannot call Ticketry tools.
3. **Legacy profile deletion timing.** Main performs best-effort ModuleLink import and then deletes legacy files. Confirm whether Rust's snapshot and support policy requires retaining a recoverable copy outside the live config path.
4. **Pinned libghostty API.** Confirm the current pin supports `ghostty_surface_key_is_binding` and the clipboard completion calls with main's signatures.
5. **Release screenshots.** Main's images document an older UI and do not prove Rust parity. Regeneration is a release choice, not an implementation dependency.

## Final assessment

The existing Rust migration work is relevant. It replaced the correct architecture and already covers several runtime and interaction fixes more safely than main. The mistake would be treating `602596a` alone as the parity boundary. The authoritative remaining scope begins with main's product-model decisions in `3a5f434`, carries the ordered 0044 to 0051 sequence and its later multi-database correction, then finishes the dependent React, Ghostty, installed-artifact, and version behavior.
