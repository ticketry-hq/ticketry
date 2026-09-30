# Main parity review for 602596a1ea0146a1d19aad20912bdd9d3b2f1dfe

Research snapshot: 2026-08-27. The behavioral classifications use Git objects
and files in this worktree. Ticketry was consulted afterward only to reconcile
the findings with existing work and avoid duplicate Stories.

## Commit ordering

The reviewed branch is `work/rust-main-parity` at
`e5c6ab5ce4e120d648379dde864f24f45827a7db`. The relevant merge base with
`origin/main` is `aefbd1b56c2b8763430c96d7f4b5fd61669f54c0`.

Git identifies this commit as the direct child of the previously reviewed
commit:

```text
3a5f434a90696f40a4911e401a84db009cdfa4e7
└── 602596a1ea0146a1d19aad20912bdd9d3b2f1dfe
```

`git show -s --format='%H %P %s'` reports parent `3a5f434...` for
`602596a...`. Both `git log --reverse --topo-order --ancestry-path
3a5f434...origin/main` and the second-parent content history leading into main's
next merge place `602596a...` first. The next commit reviewed here is therefore:

- Commit: `602596a1ea0146a1d19aad20912bdd9d3b2f1dfe`
- Subject: `Harden terminal runtime ownership and agent launch isolation`
- Author and commit date: Ticketry Maintainers, 2026-08-21 18:31:09 +0530
- Parent: `3a5f434a90696f40a4911e401a84db009cdfa4e7`
- Diff size reported by Git: 176 files, 9,185 insertions, 805 deletions

## Intent

The subject names only the terminal-runtime half of the change. The complete
commit does considerably more. It prevents one Studio instance from routing an
agent to another instance's MCP listener or terminating another instance's tmux
run. It also tells agents how to invoke required skills using each provider's
syntax. Alongside that runtime work, it adds the next three WorkTracker data
migrations, moves module ordering into a typed presentation record, adds hidden
module tabs and their restoration flows, persists heterogeneous workspace-tab
order, adds a Codex model, and fills in several native and keyboard details.

The Django REST, OpenAPI, and generated SDK files are implementations of those
behaviors for the retired backend. They are not code to restore in the Rust
application.

## Classification summary

| Classification | Meaningful concerns |
| --- | ---: |
| Already present or behaviorally equivalent | 2 |
| Django-only and obsolete | 2 grouped artifact families |
| Not applicable to the current architecture | 2 |
| Missing and should be ported | 5 |
| Partially present and needs follow-up | 6 |

The counts group generated files and closely coupled UI changes by behavior.
They are not file counts.

## Detailed findings

### Runtime ownership and launch isolation

#### Foreign-runtime termination is already behaviorally equivalent

Classification: **Already present or behaviorally equivalent**.

Source evidence:

- `602596a...:backend/apps/terminals/runtime_ownership.py` reads the persisted
  terminal session's `runtime_namespace` and rejects a namespace outside the
  active runtime and its legacy namespaces.
- `602596a...:backend/apps/terminals/launch.py` performs that check before it
  writes an ended state or asks tmux to terminate the run.
- `602596a...:backend/apps/terminals/tests/test_api.py` proves that both explicit
  delete and self-termination return a conflict for a foreign runtime, do not
  call the runtime, and leave the run and terminal session active. It also
  preserves legacy rows with no namespace and namespaces formerly owned by the
  same runtime.

Current Rust evidence:

- [`terminal_cleanup/runtime.rs`](../../studio/src-tauri/src/terminal_cleanup/runtime.rs)
  derives a verified `RuntimeIdentity` from the persisted run and runtime
  namespace. Its inspection and kill results distinguish `Foreign`,
  `Ambiguous`, `Missing`, and `Unavailable`.
- [`terminal_cleanup/service.rs`](../../studio/src-tauri/src/terminal_cleanup/service.rs#L190)
  refuses foreign or ambiguous identities before a kill. It records a conflict
  instead of settling the run as terminated. It also verifies absence after a
  successful kill before it commits the cleanup.
- [`terminal_cleanup.rs`](../../studio/src-tauri/tests/terminal_cleanup.rs#L159)
  proves that a foreign identity causes `terminal_runtime_identity_conflict`,
  performs no kill, and leaves a durable conflict effect.

The Rust path is stricter than the source path because it verifies both the
stored identity and the runtime observation. The source's HTTP 409 and exposed
owner namespace do not map directly to the Rust GraphQL and MCP contracts, but
the behavior that matters is present: a process cannot report a foreign run as
terminated.

#### MCP termination failures already return an explicit failure result

Classification: **Already present or behaviorally equivalent**.

Source evidence:

- `602596a...:surfaces/worktracker-agent/api/run_control.py` converts a non-2xx
  Studio response into an agent-readable object with `ok: false` and a stable
  `error` value.
- `602596a...:surfaces/worktracker-agent/tests/test_termination_tool.py` covers
  the new `run_owned_by_other_runtime` refusal.

Current Rust evidence:

- [`work_management/mcp/run_termination.rs`](../../studio/src-tauri/src/work_management/mcp/run_termination.rs#L13)
  returns `ok: true` only after cleanup succeeds. Every cleanup error is
  returned as `{"ok": false, "error": ...}`.
- The same file preserves the established compatibility codes for missing,
  unbound, pending, and unavailable runs.

The separate Python forwarding service no longer exists, but the Rust MCP
result already has the source behavior at the public boundary.

#### Cross-instance MCP routing is prevented, but the degraded launch policy differs

Classification: **Partially present and needs follow-up**.

Source evidence:

- `602596a...:backend/apps/terminals/launch.py` adds
  `WORKTRACKER_MCP_UNAVAILABLE`. If this instance cannot start its own MCP
  service, provider adapters omit MCP configuration rather than fall back to
  port 8123, which another install may own.
- The Claude, Codex, Gemini, and Agy injectors all accept `mcp_url=None` and
  retain lifecycle hooks without an MCP server.
- `602596a...:studio/src-tauri/src/supervisor.rs` passes the absence marker to
  the sidecar. `studio/src-tauri/src/lib.rs` tells the user that agents launched
  during the outage start without WorkTracker MCP tools.

Current Rust evidence:

- [`desktop/rust_runtime_launch.rs`](../../studio/src-tauri/src/desktop/rust_runtime_launch.rs#L45)
  starts with an empty MCP URL and replaces it only after this process binds its
  own in-process listener.
- [`work_management/mcp/authority.rs`](../../studio/src-tauri/src/work_management/mcp/authority.rs#L38)
  stores random run grants in process memory. A token issued by one listener is
  not accepted by another listener even when both read the same database.
- [`terminal_lifecycle/work.rs`](../../studio/src-tauri/src/terminal_lifecycle/work.rs#L428)
  explicitly blocks every provider launch while the MCP URL is empty. It never
  redirects a launch to the default port.
- [`desktop/user_notices.rs`](../../studio/src-tauri/src/desktop/user_notices.rs#L24)
  still labels the acknowledgement "Continue without MCP", although provider
  launch is blocked.

The security goal is met. Cross-instance routing cannot occur. The remaining
difference is product policy: main permits an agent launch with hooks but no
WorkTracker tools, while Rust fails closed. This should become a Story only if
Ticketry wants provider launches to continue during an MCP bind failure. If the
fail-closed rule is intentional, the notice should say that launches are
blocked instead of implying otherwise.

#### Provider-qualified required-skill instructions are missing

Classification: **Missing and should be ported**.

Source evidence:

- `602596a...:backend/apps/terminals/agents/registry.py` replaces the narrowly
  named entry-skill prefix with a provider `invocation_prefix`. Codex uses `$`;
  the other registered providers use `/`.
- `602596a...:backend/apps/terminals/agents/skills/preflight.py` formats every
  required skill with that prefix in the launch prompt and rejects an unknown
  prefix.
- `602596a...:backend/apps/terminals/tests/test_required_skill_launch.py` and
  `test_session_spawn.py` prove `$to-spec` and `$to-tickets` for Codex,
  `/to-spec` and `/to-tickets` for Claude, and no typed command when no entry
  skill is selected.

Current Rust evidence:

- [`launch_planning/provider.rs`](../../studio/src-tauri/src/launch_planning/provider.rs)
  has no invocation-prefix field in `ProviderContract`.
- [`launch_planning/materialize.rs`](../../studio/src-tauri/src/launch_planning/materialize.rs#L50)
  verifies that each required skill exists, but it passes the original prompt
  to every provider unchanged at lines 190 through 228.
- A repository search finds no current `Ticketry invocation resources` or
  `Required skills available for this invocation` prompt envelope.

The Rust launch planner should own this behavior. It should use one provider
contract value for both required-skill references and the earlier entry-skill
work, while keeping required skills descriptive rather than typing every skill
as a command.

### WorkTracker data and module presentation

#### Migration 0049 and server-owned workspace-tab order are missing

Classification: **Missing and should be ported**.

Source evidence:

- `602596a...:backend/worktracker/migrations/0049_issue_workspace_tab_order.py`
  adds an empty-list JSON field to every issue after migration 0048.
- `602596a...:backend/worktracker/rest/work_item_serializers.py` defines stable
  `details`, `doc`, and `terminal` identities. Details has no id, document and
  terminal entries require ids, and duplicate identities are rejected.
- `602596a...:backend/worktracker/tests/test_workspace_tab_order_api.py` proves
  empty defaults, interleaved persistence, pruning on the next write, invalid
  identity rejection, and a named read/write contract.

Current Rust evidence:

- [`entities/work_management/issue.rs`](../../studio/src-tauri/src/entities/work_management/issue.rs#L6)
  has no workspace-tab-order field or relation.
- The adoption ledger ends at `worktracker.0043_story_run_now_workflow`; it has
  no 0049 entry. The Rust import and classification artifacts also have no
  0049 generation.
- No GraphQL operation, entity, or frontend feature named `WorkspaceTabOrder`
  exists in the current worktree.

Port this as a migration-first, generated Seaography model field or restricted
WorkItem update field. Do not recreate the source REST endpoint or generated
REST SDK.

#### Durable workspace-tab behavior is missing end to end

Classification: **Missing and should be ported**.

Source evidence:

- `602596a...:studio/src/features/workspace-tabs/ordering.ts` restores saved
  precedence, appends new visible tabs, keeps known dormant tabs in their saved
  slots, and prunes unknown identities.
- `602596a...:studio/src/features/workspace-tabs/mutations.ts` serializes saves
  per work item and provides optimistic reorder with rollback.
- `602596a...:studio/src/features/workspace-tabs/internal/useWorkspaceTabReorderDrag.ts`
  locks drag until the order is loaded, blocks another save while one is
  pending, preserves hidden identities, and suppresses the click after drop.
- `602596a...:studio/src/app/navigation/full-sidebar-view/fullSidebarViewNavigation.ts`
  loads the saved order for every candidate work item before cycling live
  terminals, then cycles terminals in that order.
- `602596a...:studio/src/test/overhaulWorkspaceTabOrderAcceptance.test.tsx`
  covers reload, closed documents, dormant terminals, appended tabs, mixed
  terminal cycling, drag seams, optimistic display, failure rollback, and
  scroll retention. `overhaulTerminalNavigationAcceptance.test.tsx` adds the
  unopened-workspace case.

Current Rust evidence:

- [`useWorkspaceTabPresentation.ts`](../../studio/src/app/shell/ticket-workspace/selected-ticket/internal/useWorkspaceTabPresentation.ts#L82)
  always builds `Details`, then open documents, then terminal session ids.
- [`WorkspaceTabStrip.tsx`](../../studio/src/app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTabStrip.tsx#L101)
  renders those groups directly and has no drag contract.
- [`liveTerminalCycle.ts`](../../studio/src/features/studio/lib/liveTerminalCycle.ts#L37)
  orders a work item's live terminals by run start time and session id, not by
  the workspace strip.

This is one cross-layer feature with a clear dependency on migration 0049. The
Apollo cache should remain the frontend's sole server-state owner.

#### Migration 0050 and the dedicated module-presentation record are partial

Classification: **Partially present and needs follow-up**.

Source evidence:

- `602596a...:backend/worktracker/migrations/0050_module_presentation.py`
  creates one `ModulePresentation` per module when its project was already in
  manual mode. It copies the module rank, leaves automatic projects rowless,
  and removes `Project.manual_module_order`.
- `602596a...:backend/worktracker/models/module_presentation.py` owns `rank`
  and `tab_hidden` in a one-to-one record keyed by module id.
- `602596a...:backend/worktracker/module_order.py` treats any non-empty
  presentation rank as manual mode. Automatic projects keep newest-created
  order until the first drag.
- `602596a...:backend/worktracker/services/module_reorder.py` moves module
  reorder out of generic work-item reorder. The first drag seeds every active
  module under the project lock, then updates presentation rank.
- `602596a...:backend/worktracker/services/modules.py` and
  `test_module_front_insertion.py` preserve creation semantics during the data
  move: automatic projects create no presentation row and remain newest-first;
  manual projects create a distinct rank ahead of the first active module,
  ignoring archived modules when choosing that rank.
- `602596a...:docs/decisions/2026-08-20-module-presentation-table.md` records the
  model decision and states that per-client selection and sidebar visibility
  remain frontend state.

Current Rust evidence:

- [`entities/work_management/project.rs`](../../studio/src-tauri/src/entities/work_management/project.rs#L6)
  still stores `manual_module_order` on Project.
- [`entities/work_management/issue.rs`](../../studio/src-tauri/src/entities/work_management/issue.rs#L18)
  still stores module and task ranks together on Issue.
- [`work_management/read_queries.rs`](../../studio/src-tauri/src/work_management/read_queries.rs#L87)
  and [`work_management/commands/reorder.rs`](../../studio/src-tauri/src/work_management/commands/reorder.rs#L75)
  implement automatic newest-first reads and first-drag seeding through the old
  Project flag and Issue rank. The current GraphQL project query exposes that
  older shape. There is no module-presentation entity, migration, Seaography
  registration, or adoption bridge.
- Existing module reorder and canonical-order behavior is real and should be
  preserved, including front insertion when a module is created. The missing
  part is the data move and the new typed home for order and visibility.

This needs a Rust migration, adoption path, generated entity and GraphQL
contract, and a move of module reorder to the new model-shaped boundary.
Migration 0050 depends on 0049, which in turn depends on the earlier unported
0044 through 0048 sequence.

#### Hidden module tabs, restoration, and the module picker are missing

Classification: **Missing and should be ported**.

Source evidence:

- `602596a...:backend/worktracker/services/module_visibility.py` creates or
  updates only `tab_hidden`, preserves rank, rejects unknown modules, and relies
  on the one-to-one cascade to avoid stale rows.
- `602596a...:studio/src/features/module-tabs/queries.ts` filters only the tab
  strip. Hidden modules remain in the canonical module collection used by the
  sidebar and planning surfaces.
- `602596a...:studio/src/app/shell/ticket-workspace/ModuleTabStrip.tsx` adds a
  non-destructive hide control. Hiding the selected tab chooses the nearest
  visible tab to the right, then the left, and clears selection if none remain.
- `602596a...:studio/src/features/module-tabs/useRestoreAndSelectModule.ts`
  makes sidebar and picker selection restore a hidden tab before selection.
- `602596a...:studio/src/features/module-tabs/ModulePicker.tsx` changes the fixed
  plus control into an accessible picker. It always offers creation and lists
  only hidden, non-archived modules in canonical order with search, arrow-key,
  Enter, Escape, outside-click, and focus-return behavior.
- `602596a...:studio/src/test/overhaulModuleVisibilityAcceptance.test.tsx` and
  `overhaulModulePickerAcceptance.test.tsx` cover the all-hidden workspace,
  startup fallback, restoration without reorder, agent activity, canonical
  position, empty projects, and picker accessibility.
- `602596a...:studio/src/test/overhaulOnboardingModuleAcceptance.test.tsx`
  keeps the onboarding coach mark off the new picker trigger so opening the
  picker does not accidentally become an onboarding requirement.

Current Rust evidence:

- [`ModuleTabStrip.tsx`](../../studio/src/app/shell/ticket-workspace/ModuleTabStrip.tsx#L62)
  opens Add Module directly and renders every module as a tab.
- [`ModuleTab.tsx`](../../studio/src/app/shell/ticket-workspace/ModuleTab.tsx#L35)
  has no hide action.
- [`TicketWorkspace.tsx`](../../studio/src/app/shell/ticket-workspace/TicketWorkspace.tsx)
  has no all-hidden recovery state and always renders the work area and terminal
  panel.
- No current module-presentation query, visibility mutation, restoration helper,
  or module picker exists.

This behavior should follow the 0050 data work. The port should retain Apollo
ownership and avoid a second hidden-module snapshot in local state.

#### Modules-sidebar reachability and persistence are partial

Classification: **Partially present and needs follow-up**.

Source evidence:

- `602596a...:studio/docs/adr/0005-the-sidebar-is-an-installation-gated-surface.md`
  supersedes the installation gate because the Modules pane is the recovery
  route when all module tabs are hidden.
- `602596a...:studio/src/state/persistence.ts` advances sidebar visibility to
  `studio.sidebarVisible:v2`, deliberately ignoring the old forced-closed value
  and defaulting the now-required recovery surface to open when v2 is absent.
- `602596a...:studio/src/app/startup/bootstrapStudio.ts` stops forcing the
  Modules pane open and honors the persisted choice.
- `602596a...:studio/src/app/shell/StudioFooter.tsx` adds a persistent Modules
  action with the effective binding, next-action accessible name, and expanded
  state. Its three-column layout keeps navigation hints centered.
- `602596a...:studio/src/test/overhaulCommandBarModulesToggleAcceptance.test.tsx`
  covers the footer, direct state requests, focus navigation, default binding,
  and binding override. `overhaulModuleSelectionAcceptance.test.tsx` covers the
  versioned persistence upgrade.

Current Rust evidence:

- [`configStore.ts`](../../studio/src/features/studio/stores/configStore.ts#L21)
  still allows the installation feature flag to make the sidebar absent, and
  the empty default disables it.
- [`bootstrapStudio.ts`](../../studio/src/app/startup/bootstrapStudio.ts#L65)
  bypasses the sidebar when the flag is off and forces it open for the
  modules-only composition.
- [`persistence.ts`](../../studio/src/state/persistence.ts#L3) still uses the v1
  visibility key.
- [`StudioFooterActions.tsx`](../../studio/src/app/shell/StudioFooterActions.tsx#L10)
  contains Terminal and Settings only. The current footer hint can name the
  toggle only when the gated binding remains effective.

The sidebar state machine already exists, so this is not a new shell. The port
must retire the installation gate for the Modules pane, preserve the Projects
retirement decision, add the persistent footer action, and stop startup from
overwriting the user's v2 choice.

#### Jump badges and visible-only position shortcuts are partial

Classification: **Partially present and needs follow-up**.

Source evidence:

- `602596a...:studio/src/features/module-tabs/useModuleJumpBadges.ts` observes
  the effective binding registry and shows badges only while its exact modifier
  set is held. It clears on key changes, blur, pointer input, document hiding,
  native-terminal keyboard ownership, or disabled modal state.
- `602596a...:studio/src/app/navigation/sharedNavigation.ts` changes module
  position shortcuts to count visible tabs only.
- `602596a...:studio/src/test/overhaulModuleJumpBadgesAcceptance.test.tsx`
  covers the first ten visible tabs, custom bindings, hidden and reordered tabs,
  native focus, modal disablement, and no rerender for unchanged modifiers.
- `602596a...:studio/src/test/overhaulModuleVisibilityAcceptance.test.tsx`
  proves that hidden modules receive no position shortcut.

Current Rust evidence:

- [`sharedNavigation.ts`](../../studio/src/app/navigation/sharedNavigation.ts#L28)
  already supports webview position actions, but indexes the complete module
  list.
- No `ModuleJumpBadge`, held-modifier observer, or native-keyboard-engaged event
  exists.
- The current native chord enum contains only panel toggle and Settings, so the
  earlier native module-position baseline on which this commit builds is also
  absent.

The visible-only delta belongs with hidden tabs. Native module positions are a
dependency from the previous commit, not a new change introduced here.

#### Module activity in the sidebar is partial

Classification: **Partially present and needs follow-up**.

Source evidence:

- `602596a...:studio/src/features/agents/status/ModuleLifecycleChicklets.tsx`
  extracts the existing module-level lifecycle badges into a reusable component.
- `602596a...:studio/src/app/shell/sidebar/modules/ModuleRow.tsx` adds that
  component to each sidebar row so activity remains visible when a module tab
  is hidden.
- `602596a...:studio/src/test/overhaulModuleVisibilityAcceptance.test.tsx`
  proves that activity neither restores a hidden tab nor disappears with it.

Current Rust evidence:

- [`ModuleTab.tsx`](../../studio/src/app/shell/ticket-workspace/ModuleTab.tsx#L13)
  already renders module lifecycle badges on tabs.
- [`ModuleRow.tsx`](../../studio/src/app/shell/sidebar/modules/ModuleRow.tsx#L35)
  renders only the module icon and name.

The status selector is already available. The follow-up is to reuse it in the
sidebar without coupling agent activity to tab visibility.

#### Migration 0051 and `gpt-5.3-codex-spark` are missing

Classification: **Missing and should be ported**.

Source evidence:

- `602596a...:backend/worktracker/migrations/0051_codex_5_3_model_catalog.py`
  adds `gpt-5.3-codex-spark` only when the Codex provider exists. It uses
  `get_or_create` and adds no permitted reasoning rows.
- `602596a...:backend/worktracker/tests/test_migration_codex_5_3_model_catalog.py`
  verifies the model and its empty reasoning set.
- `602596a...:studio/src/test/overhaulSettingsAcceptance.test.tsx` proves that
  Settings can select this model, shows no invented reasoning choices, and
  saves null reasoning.

Current Rust evidence:

- [`provider_catalog_provisioning.rs`](../../studio/src-tauri/src/settings_persistence/provider_catalog_provisioning.rs#L22)
  provisions only `gpt-5.4` for Codex.
- A repository search finds no `gpt-5.3-codex-spark` outside the aggregate
  parity audit.
- The adoption ledger and generated schema corpus have no migration 0051.

This requires both fresh-install provisioning and an idempotent upgrade path.
The model must have model-default reasoning, represented by no model-to-reasoning
rows. Migration 0051 follows 0050 in main, so its Rust adoption record should
preserve that order even though the data insertion itself is independent.

### Native keyboard details

#### `Cmd+Escape` returns focus but leaves Rust Studio state engaged

Classification: **Partially present and needs follow-up**.

Source evidence:

- `602596a...:studio/src-tauri/native/libghostty_view.m` moves exact
  `Cmd+Escape` into the shared native chord policy and reports a new
  `BODY_DISENGAGE` chord after handing focus back.
- `602596a...:studio/src/app/navigation/nativeTerminalChords.ts` routes that
  chord through the same `disengageEditViewBody` operation as the webview.
- `602596a...:studio/src/test/overhaulTerminalPanelNativeChordAcceptance.test.tsx`
  proves that the client leaves typing mode and switches to keyboard modality
  while retaining the active body zone.
- `602596a...:studio/src/features/agents/terminal/internal/useNativeViewerHostEffects.ts`
  also reports when a native terminal is about to take keyboard ownership, so
  jump badges disappear before AppKit takes the keys.

Current Rust evidence:

- [`libghostty_view.m`](../../studio/src-tauri/native/libghostty_view.m#L181)
  already recognizes `Cmd+Escape` and returns first responder to the superview.
  It returns before invoking the chord callback.
- [`native_terminal/chords.rs`](../../studio/src-tauri/src/native_terminal/chords.rs#L20)
  and [`nativeTerminalChords.ts`](../../studio/src/app/navigation/nativeTerminalChords.ts#L22)
  have no body-disengage value.
- The webview store can therefore remain `editViewBodyEngaged=true` after the
  native view has released the keyboard.

This is the small native fix most likely to disappear inside the broader
module work. It can be implemented independently. The keyboard-engagement
notification can land with jump badges, but the `Cmd+Escape` state correction
does not need to wait for module presentation.

### Architecture-specific and documentation changes

#### Django REST, OpenAPI, and generated SDK work is obsolete

Classification: **Django-only and obsolete**.

Source evidence:

- The commit adds DRF viewsets and serializers for module presentation and
  workspace-tab order, registers REST routes, expands `openapi.json`, and
  regenerates Python and TypeScript REST SDKs.
- It also adds DRF override records for module visibility and reorder, and
  renames generated `KindEnum` types to avoid a schema naming collision.

Current Rust evidence:

- `AGENTS.md` and `CLAUDE.md` make SeaORM, Seaography, GraphQL, and Apollo the
  governing data path and state that Ticketry has no product REST API.
- The current worktree has no Django backend or generated REST SDK surface.

The underlying product behaviors are classified separately above. None of the
DRF, OpenAPI, or generated REST code should return.

#### Python sidecar ownership and injection code is obsolete

Classification: **Django-only and obsolete**.

Source evidence:

- Most terminal-runtime changes live under `backend/apps/terminals/**`, the
  Python launchers, and `surfaces/worktracker-agent/**`.
- The commit also changes the old Tauri sidecar supervisor to pass an MCP
  availability environment variable.

Current Rust evidence:

- The desktop now owns terminal launch, lifecycle, cleanup, reconciliation,
  provider materialization, and MCP in process under `studio/src-tauri/src/`.
- There is no Python backend process to inject or supervise.

Only the behavioral requirements belong in Rust. The source modules are not
portable implementation units.

#### Show HN research notes are not runtime parity work

Classification: **Not applicable to the current architecture**.

Source evidence:

- The commit adds `docs/research/show-hn-official-guidance.md` and
  `docs/research/show-hn-ghostty-matt-pocock-positioning.md`.
- Neither file changes application behavior. One summarizes first-party Show HN
  rules; the other fact-checks proposed product positioning.

These are standalone launch-research artifacts. Their absence does not create a
Rust application behavior gap. They can be copied only as a separate
documentation decision, not as a parity Story.

#### Studio terminology, acceptance matrix, and browser e2e changes are supporting evidence

Classification: **Not applicable as independent implementation work**.

Source evidence:

- `studio/CONTEXT.md` defines hidden module tabs and jump badges and revises the
  sidebar terminology.
- `studio/docs/overhaul-acceptance.md` adds cases 149 through 179 and revises
  cases 132 and 139.
- `studio/e2e/web-app.spec.ts` opens the module picker and then selects Create
  new module instead of opening Add Module directly.

These files specify and verify the product changes already classified above.
They should be updated with the corresponding Rust implementation, using the
current numbered acceptance suite. They do not need separate Stories.

## Ticketry reconciliation

Every missing or partial concern was searched against existing work before a
new Story was created.

| Concern | Existing or newly created coverage |
| --- | --- |
| Provider-qualified required-skill references | `CODING-920`, with implementation and review follow-ups `CODING-924` through `CODING-927` |
| Durable workspace-tab order and migration 0049 behavior | `CODING-821`, with implementation and review follow-ups `CODING-917` through `CODING-919` and `CODING-928` through `CODING-932` |
| Module-presentation data move, hidden tabs, and migration 0050 behavior | `CODING-914`, with implementation and review follow-ups `CODING-921` through `CODING-923` and `CODING-933` through `CODING-948` |
| Mandatory sidebar recovery and persistence | `CODING-938`, with follow-ups `CODING-941` through `CODING-948` |
| Visible-only module shortcuts and jump badges | `CODING-916`, `CODING-936`, `CODING-937`, and `CODING-943` through `CODING-945`; the native position-shortcut dependency is also captured by `CODIN-1469` and `CODIN-1475` |
| Searchable hidden-module picker | `CODING-949`, with implementation and review follow-ups `CODING-951` through `CODING-959` |
| Native `Cmd+Escape` body disengagement | `CODIN-1339` |
| MCP collision recovery and user notice | `CODING-42`, with `CODING-49` through `CODING-51` |
| `gpt-5.3-codex-spark` with model-default reasoning | Newly created as `CODING-1154` |

The source permits provider launches without MCP when its listener is
unavailable. Rust deliberately fails closed, never routes to another listener,
and existing collision-recovery work owns endpoint recovery and notice
delivery. No parity Story was created to weaken that security policy. The
current acknowledgement text, `Continue without MCP`, should be corrected as
part of the existing notice work if it is still reachable after `CODING-42`.

## Missing or partial concerns and disposition

1. Provider-qualified required-skill references are already captured by
   `CODING-920` and its children.
2. Migration 0049 and durable workspace-tab order are already captured by
   `CODING-821` and its children.
3. Migration 0050, module presentation, hidden tabs, restoration, sidebar
   recovery, visible-only shortcuts, jump badges, sidebar activity, and the
   picker are already captured by `CODING-914`, `CODING-916`, `CODING-938`,
   `CODING-949`, and their implementation and review follow-ups.
4. Migration 0051 behavior for `gpt-5.3-codex-spark` had no matching work item.
   `CODING-1154`, **Provision gpt-5.3-codex-spark with model-default
   reasoning**, now owns fresh-install provisioning, existing-install adoption,
   empty reasoning associations, null persistence, launch validation, and unit,
   integration, and numbered acceptance coverage.
5. Native `Cmd+Escape` body disengagement is already captured by `CODIN-1339`.
6. The MCP-degraded-launch difference does not require a new Story while Rust's
   fail-closed policy remains intentional. Existing `CODING-42` owns collision
   recovery and notices.

Ordering matters. Main's migrations are linear: 0049 follows 0048, 0050 follows
0049, and 0051 follows 0050. The current Rust ledger stops at 0043, so the
schema Stories depend on the earlier 0044 through 0048 parity work even where a
particular SQL change has no direct column dependency.

## Accounting verdict

The commit is fully researched, classified, and accounted for in Ticketry. Its
runtime-ownership guard and MCP failure shape are already covered by Rust. Its
Python, DRF, OpenAPI, and REST SDK implementations are obsolete. Every product
gap is either represented by existing work or by new Story `CODING-1154`. Rust
retains its explicit fail-closed launch policy when the in-process MCP listener
cannot bind; changing that policy would be a separate product decision, not an
unresearched parity omission.
