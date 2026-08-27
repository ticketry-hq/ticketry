# Rust and main parity audit

Research snapshot: 2026-08-27. The remote refs were refreshed with
`git fetch --all --prune`; the audit then used only repository refs, commits,
diffs, and source files. The current `rust-migration` worktree was already
heavily dirty. Findings marked "working tree" include uncommitted files as they
existed during this audit.

## Bottom line

Do not merge `origin/main` into `rust-migration` wholesale. Main's useful
changes are mixed with the Django backend, Python sidecar, OpenAPI contract,
generated SDKs, and TanStack-era frontend code that the Rust cutover removed.
The prior audit worktree demonstrates the result: it has `MERGE_HEAD`
`78201ef`, 359 unmerged paths, and 303 other staged or modified paths while its
branch tip remains `5b3ecfb`.

There are real parity gaps. The largest is the product schema and behavior from
Django migrations 0044 through 0051. Native Ghostty clipboard and keyboard
behavior, several Studio interactions, and one root package version bump also
need selective ports. Implement these against the Rust SeaORM, Seaography,
GraphQL, and Apollo architecture. The old Django and REST implementations are
evidence of intent, not code to restore.

## Ref topology

All Rust-versus-main comparisons have the same merge-base:
`aefbd1b56c2b8763430c96d7f4b5fd61669f54c0`, the merge of PR #24 on
2026-08-19.

| Ref | Tip | Relationship |
| --- | --- | --- |
| `rust-migration` | `36db2201a60dac593a5cc18acab0c430bea598ff` | One commit ahead of `origin/rust-migration` |
| `origin/rust-migration` | `5b3ecfb38a313ee9b03923579260c5306d802ac8` | Seven commits unique from the merge-base |
| `audit/CODING-1030-rust-main-parity` | `5b3ecfb38a313ee9b03923579260c5306d802ac8` | No audit commit; branch equals `origin/rust-migration` |
| `main` | `44a3c6e1aa78da7af765e8fa436e683335cff2ce` | Three commits unique from the merge-base; five commits behind `origin/main` |
| `origin/main` and `origin/HEAD` | `78201ef0005cca46ea798c78553fb37b54fc09c0` | Eight commits unique from the merge-base |

`git rev-list --left-right --count` reports `8 8` for
`rust-migration...origin/main`, `7 8` for
`origin/rust-migration...origin/main`, `8 3` for
`rust-migration...main`, and `0 5` for `main...origin/main`. `git cherry`
marks all five non-merge main patches as absent from both Rust tips. No main
content patch has an exact patch-equivalent commit on the Rust line.

The audit branch was created from `origin/rust-migration` and has no later
reflog entry. Its separate worktree at
`/Users/karthik/merge_conflicts/coding/ticketry-rust-CODING-1030` is in an
unfinished merge of `origin/main`. Most conflicts are delete/modify conflicts
where main tries to restore `backend/**`, `surfaces/worktracker-*`, and old
frontend transports deleted by the cutover.

## Commits that removed Django

The removal happened in two commits.

1. `501c74a8d3949b60b9c020a08abd3216f3249c42`, `all slices done!`, removed the
   migrated Python execution and runtime portions. It reduced `backend/` from
   539 tracked files to 431. The deleted areas include
   `backend/apps/execution/`, `backend/apps/runs/`, large parts of
   `backend/apps/terminals/`, and ASGI/runtime glue under
   `backend/studio_server/`.
2. `5b3ecfb38a313ee9b03923579260c5306d802ac8`, `Complete Rust-only desktop
   cutover`, removed the remaining 431 `backend/` files, leaving zero. It also
   removed the OpenAPI artifacts and Python/TypeScript generated SDK surfaces
   while completing the Rust replacements under `studio/src-tauri/src/`.

The exact commit associated with the final Django deletion is `5b3ecfb`. The
earlier `501c74a` is part of the same two-stage retirement and should be kept in
the history record.

## Main commits after divergence

| Commit | What landed | Classification for the Rust app |
| --- | --- | --- |
| `3a5f434a90696f40a4911e401a84db009cdfa4e7` | `Harden repository governance and backend REST boundaries`, 595 files | Mixed. Port schema 0044-0048 and selected native and Studio behavior. Do not port DRF, sidecar, OpenAPI, SDK, or TanStack machinery. |
| `602596a1ea0146a1d19aad20912bdd9d3b2f1dfe` | `Harden terminal runtime ownership and agent launch isolation`, 178 files | Mixed. Port schema 0049-0051, module presentation, workspace-tab order, module picker/jump behavior, and relevant native focus fixes. Python runtime ownership is obsolete. |
| `44a3c6e1aa78da7af765e8fa436e683335cff2ce` | Merge PR #28 | Topology only. It has no independent content beyond `3a5f434` and `602596a`. |
| `9d752d77b3da9766c3e4c79e32624cc66d860ddb` | Prepare 0.2.0 | Partly applicable. The root `package.json` bump is still missing. Studio and Tauri are already 0.2.0. Backend and SDK bumps are obsolete. Two UI edits depend on the missing main-only work-item activation flow. |
| `24c28f1e299ab15f7b1c9068c5f4efb45d6c4683` | Fix installed-artifact acceptance for the current schema | Adapt after the schema port. Its project readiness check and fresh issue setup match the post-Workspace schema, but its raw SQL expects main's 0049 and terminal table shape rather than the current Rust schema. |
| `041b78c45c3c3bde2437141dcdfbad8cc070e634` | Merge PR #47 | Topology only. No independent content beyond `9d752d7` and `24c28f1`. |
| `e8239636b451a01c07779f5ab60f177d0ae71d64` | Add 0.2.0 download badge and three screenshots | Release documentation only. The README text describes the deleted Django layout, and the screenshots should be regenerated from the Rust app if retained. |
| `78201ef0005cca46ea798c78553fb37b54fc09c0` | Merge PR #48 | Topology only. This is the current `origin/main` tip. |

## Applicable parity gaps

### Schema and product data

The Rust adoption ledger stops exactly at
`worktracker.0043_story_run_now_workflow` in
[`provisioning-ledger.v1.sql`](../../studio/src-tauri/src/installation_adoption/provisioning-ledger.v1.sql).
Main adds eight sequential migrations across `3a5f434` and `602596a`:

| Main migration | Rust parity work |
| --- | --- |
| `0044_codex_5_6_model_catalog.py` | Add the three Codex 5.6 model rows and their allowed reasoning levels to the Rust-owned catalog data. Current tests mention these model names, but the Rust provisioning data does not seed this migration. |
| `0045_project_onboarding_required.py` | Move `onboarding_required` from Workspace to Project and migrate the installation value. |
| `0046_remove_workspace.py` | Remove Workspace and `Project.workspace_id`, make project slug globally unique, and preserve duplicate slugs with deterministic suffixes. Current [`workspace.rs`](../../studio/src-tauri/src/entities/work_management/workspace.rs) and [`project.rs`](../../studio/src-tauri/src/entities/work_management/project.rs) still model the old relationship. |
| `0047_launch_binding_entry_skill.py` | Add nullable `LaunchBinding.entry_skill` and seed `grill-with-docs`, `to-spec`, and `to-tickets`. Current [`launch_binding.rs`](../../studio/src-tauri/src/entities/work_management/launch_binding.rs) and [`reviewed_defaults.json`](../../studio/src-tauri/resources/work-management/reviewed_defaults.json) have neither field nor `entrySkills`. |
| `0048_distinguish_workflow_state_colors.py` | Change Ideas, Grill, and Review to `#60646C`, `#FA4D56`, and `#08BDBA`. The current reviewed defaults still contain `#D12771`, `#60646C`, and `#D6409F`. |
| `0049_issue_workspace_tab_order.py` | Add persisted workspace-tab order to WorkItem/Issue. Current [`issue.rs`](../../studio/src-tauri/src/entities/work_management/issue.rs) has no field. |
| `0050_module_presentation.py` | Add `ModulePresentation(module_id, rank, tab_hidden)`, migrate manual module order, and remove `Project.manual_module_order`. The Rust entity still has `manual_module_order` and has no ModulePresentation entity. |
| `0051_codex_5_3_model_catalog.py` | Seed `gpt-5.3-codex-spark` in the Rust-owned provider catalog. |

The domain decision behind 0045, 0046, and typed module links is recorded in
`origin/main:docs/decisions/2026-08-19-typed-module-links-replace-profiles.md`.
The current Rust app still persists profiles and module links through
[`profiles.rs`](../../studio/src-tauri/src/settings_persistence/profiles.rs).
That is a product-model gap, but main's Django model, importer, REST endpoints,
and generated SDK code are not reusable. Port the decision through Rust
migrations, SeaORM entities, Seaography contracts, and Apollo operations.

The schema ports must also update the Rust provisioning SQL, adoption bridges,
classification manifest, generated entities and GraphQL, reviewed defaults,
and acceptance fixtures. Copying only the final fields would break upgrades
from existing Rust and adopted Django databases.

### Native and Studio behavior

These main behaviors are absent in both `rust-migration` HEAD and the current
working tree:

- Ghostty paste and command-key handling. Current
  [`libghostty_runtime.m`](../../studio/src-tauri/native/libghostty_runtime.m)
  returns `false` from `runtime_read_clipboard`; current
  [`libghostty_view.m`](../../studio/src-tauri/native/libghostty_view.m) lacks
  `performKeyEquivalent` and `ghostty_surface_key_is_binding`. Main's behavioral
  evidence is
  `origin/main:studio/src/test/overhaulNativeGhosttyPasteAcceptance.test.tsx`
  and `overhaulNativeGhosttyZoomAcceptance.test.tsx`.
- Native terminal shortcuts beyond panel and Settings. Current
  [`chords.rs`](../../studio/src-tauri/src/native_terminal/chords.rs) defines
  only `PanelToggle` and `Settings`. Main extends native keyboard coordination
  for module jump shortcuts and focus transitions.
- Live work-item activation and its Shift+Enter routing. Main adds
  `studio/src/app/navigation/workItemActivation.ts` and
  `overhaulLiveWorkItemActivationAcceptance.test.tsx`; neither exists in Rust.
- Final AgentPicker presentation. The reusable `providerToneClasses` exists in
  [`providerPresentation.ts`](../../studio/src/features/agents/terminal/presentation/providerPresentation.ts),
  but [`AgentPicker.tsx`](../../studio/src/features/agents/terminal/AgentPicker.tsx)
  does not use it.
- Module presentation UI. Main's `studio/src/features/module-tabs/` and
  `studio/src/features/workspace-tabs/`, plus the module picker, jump badges,
  hidden-tab behavior, and server-owned workspace-tab ordering acceptance
  cases, are absent. The data dependency is migrations 0049 and 0050.
- The footer Modules toggle. Current working-tree
  [`StudioFooterActions.tsx`](../../studio/src/app/shell/StudioFooterActions.tsx)
  contains terminal and Settings actions only.

The main tests are useful behavioral specifications, but their TanStack Query,
REST client, and old store setup should be replaced with the current Apollo and
GraphQL seams. Each port needs an updated numbered acceptance case under
`studio/src/test/`.

### Release and installed-artifact details

Both Rust refs already report 0.2.0 in `studio/package.json` and
`studio/src-tauri/tauri.conf.json`, while the root
[`package.json`](../../package.json) remains 0.1.0. The root bump from
`9d752d7` is a small direct parity fix.

The working-tree installed-artifact driver still checks
`worktracker_workspace`, so the project-only readiness changes from `24c28f1`
remain relevant after migration 0046. Its current SQL already includes
`runtime_cleanup_pending` and `output_sequence`, so that part is incorporated.
Rework the driver against the final Rust schema instead of applying the main
patch verbatim.

## Django and sidecar code that is obsolete

Do not restore any of the following:

- `backend/**`, including DRF serializers/views, Django migrations as
  executable migrations, ASGI setup, Python terminal/runtime ownership, and
  sidecar packaging;
- `openapi.json`, `openapitools.json`, or `surfaces/worktracker-sdk` and
  `surfaces/worktracker-typescript-sdk` generated contracts;
- main's REST adapters, TanStack query cache, or file-backed profile import
  implementation;
- sidecar owner-liveness code in `backend/packaging/owner_liveness.py` and the
  old `owned_sidecar.rs`/`supervisor.rs` integration;
- DRF-specific guidance added by `3a5f434`.

The generic issue templates, security files, Dependabot config, and CodeQL
workflow from `3a5f434` are independent repository-maintenance options. They
are not runtime parity requirements and can be reviewed separately.

## Recommended port order

1. Port migrations 0044-0051 in order, including adoption and generated
   contract updates.
2. Port the GraphQL/Apollo operations and acceptance fixtures for entry skills,
   workspace-tab order, and ModulePresentation.
3. Port module tabs, work-item activation, AgentPicker/footer behavior, and
   native Ghostty clipboard and keyboard fixes with acceptance coverage.
4. Align the root version and installed-artifact driver. Regenerate release
   documentation and screenshots only after the Rust UI is final.

This order avoids implementing frontend behavior against the old
Workspace/manual-module-order schema and keeps deleted Django code out of the
Rust application.
