# Workflows and issue types

Project types and state graphs govern permitted moves, stage launch policy and the read-only Story workflow guide.

Surfaces: browser, desktop
Editions: pocock, core

## Sub-features

- workflow-map-issue-types: Project issue-type identities, order, start states and the task-type picker.
- workflow-map-state-catalog: Project state names, colors, groups, order and guarded deletion.
- workflow-map-transitions: Directed workflow edges, membership and destructive-change impact previews.
- workflow-map-agent-permissions: Per-edge agent permission and human-only moves, with separate handoff policy.
- workflow-map-launch-bindings: Per-type, per-state prompt and provider/model/reasoning or Codex profile overrides.
- workflow-map-entry-automation: Auto-start and Run subtree flags on a state's launch binding.
- workflow-map-stage-skills: Ordered free-form skill tags added to fresh-start and handoff prompts.
- workflow-map-stage-skill-availability: Per-chip on-disk availability for the stage's resolved provider, with searched locations and Recheck.
- workflow-map-required-skills: Editable required-skill identifiers with provider-specific disk warnings and the unchanged pinned-catalog save/materialization gate.
- workflow-map-story-guide: Current Story stages, destinations and instructions explained without starting work.

## How to get to it

Open a module's Stories list and use `Configure <state name> state` on a state
group header. The `state-configuration-panel` overlays the selected-ticket
workspace; select an eligible task-type tab in the `Issue types` tablist, then
edit launch configuration, incoming/outgoing transition permissions and entry
automation. Close with `Close <state name> state configuration`.

Select a Story, open Details and click `Story workflow guide`. The onboarding
tour also offers `onboarding-story-workflow-guide`. The dialog is titled
`Story workflow guide`; it closes with `Close`, `Close dialog` or Escape.
The selected ticket's `issue-type-picker` exposes type choices; it is not a
workflow topology editor.

The current Settings rail has no States or Issue Types tabs.
`WorkflowSettingsPanel`, `StateCatalog` and `IssueTypesSection` retain catalog
and topology editors in source, but have no production consumer in the current
tree. Exercise their existing component tests or the generated GraphQL
operations for those seams; do not invent a Settings path. Global model
defaults live in [Settings](settings.md), reached through the footer `Open Settings`
button or keymap action `settings` (default E; Cmd+E also reaches it from the
native terminal).

## Prerequisites

A selected project supplies its catalog; a core-edition project starts with none beyond `Module` (see Expected behavior). A state configuration panel needs a
state with workflow membership for at least one task-level issue type; it
prefers Story, then the first eligible type. Otherwise it says
`No workflow is available for this state.` The guide needs a selected item
whose issue-type name is `Story`; scratch and module selections do not offer it.

Launch overrides use the provider catalog and registered Codex profiles.
Enabling auto-start requires a nonblank prompt and compatible launch options.
Actually running the policy additionally needs desktop launch readiness;
[Agent launch](agent-launch.md) owns folder, trust, provider and run preflight.

## Expected behavior

New projects are seeded by edition (CODING-2860). Pocock, which grants
`reviewedWorkflowDefaults`, seeds the reviewed catalogue: Ideas → Grill → Spec
→ Tickets → Implement → Review → Done/Cancelled, Story/PathFind/Implementation
task types plus Module, edges, launch bindings and grill-with-docs / to-spec /
to-tickets stage skills. Core seeds only the module-level `Module` type with
no start state, so it has no states, task types, edges, bindings or Configure
entry, and Stories shows `No workflow yet`. Core workflows are to be built
through MCP workflow-builder tools (CODING-2790, not yet built). See
[Projects](projects.md) for both seeding callers.

Startup adoption is also edition-specific (CODING-2862). Both editions run
every final-schema DDL step, including adding `entry_skill`, and record every
ledger checkpoint in the same order, so the resulting schema is identical.
Pocock also runs the two default-adoption data steps: it rewrites states
still holding a former reviewed Ideas/Grill/Review color, and fills unset
Story/PathFind/Implementation launch-binding entry skills from the reviewed
stage skills. Core skips both and leaves every state color and entry skill
(set, empty or unset) as it was. Core still records both checkpoints, so a
later Pocock build on the same data directory does not adopt either; this
one-way choice awaits owner confirmation on CODING-2783.

The published start state and directed edges determine permitted destinations;
changing a catalog state alone does not add an edge. Agent moves require the
edge's agent permission. The state panel shows `Agents + people` or
`People only`; its incoming/outgoing `Handoff <from> to <to>` flag is separate
from permission. Launch and handoff semantics are owned by the
[Work Management context](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/CONTEXT.md).

State policy fields apply as they change or lose focus: the prompt saves on
blur, picker selections commit, and Stage skills / Required skills commit on Enter or blur. Both lists
accept one trimmed name per commit, including commas, ignore blanks and exact
duplicates, and allow individual removal or an explicitly empty list. Stage
skills do not replace required-skill availability guards. Closing the overlay
does not undo already applied writes.

Each Stage skill and Required skill chip shows whether the stage's provider can see it:
`Available to <provider>` (with `as <installed-name>` for a case-only match),
`Missing for <provider>`, `Checking…` or `Not verified`. The provider comes
from the editor's agent, else a Codex profile, else the global launch default,
resolved by the host; an unresolved provider, unlinked/unusable module folder or
read error (including directory listing and `SKILL.md` metadata failures)
shows `Not verified` and is never reported as available. Readable matches
remain available when another skill cannot be inspected. The
`Skill availability` status names each missing skill, the provider and every
searched location, and says saving is still allowed. Existing names are checked
when the panel opens; adding/removing a name, changing provider/profile, a
global-default change and `Recheck skills` refresh it, and a slower response
for an earlier request never replaces a newer one. Checks read only the agreed
roots (Claude `.claude/skills` and `$CLAUDE_CONFIG_DIR` or `~/.claude/skills`;
Codex/Agy `.agents/skills` and `skills`, then `$CODEX_HOME` or `~/.codex/skills`
plus `.system`, or `~/.agy/skills`; Gemini `.gemini/skills` and
`$GEMINI_CLI_HOME/.gemini/skills` or `~/.gemini/skills`); only a directory
(or directory symlink) containing a SKILL.md file counts, and exact names win over
case-only matches. A check never writes to a skill directory or the binding.
The next Stage skills edit saves case-only matches under the installed spelling
and collapses names that differ only in case; a missing skill never blocks the
save. Required skills retain their configured spelling, including case-only
matches, and existing bindings are inspected without migration or automatic
rewrite. Editing either list preserves the other and unrelated binding fields.
The pinned `studio/src-tauri/resources/launch/skills.lock.json` allow-list remains
the Required skills save and launch-materialization gate: a disk-visible name
outside the list produces `invalid_required_skills`; an allowed name missing
from disk, including `grill-with-docs`, is visibly warned about and can be saved.
Plugin-provided skills are outside the searched locations.

Invalid provider/model/reasoning choices
show a control error; a stale workflow revision reloads authoritative policy
and reports `Workflow changed elsewhere. Latest settings loaded.` An unsaved
prompt draft remains in the editor across that refresh; closing and reopening
the panel shows the authoritative binding before retrying.

Retained catalog editors support adding/cancelling a state draft, name/color
edits, button or drag ordering and deletion preview. Deletion is blocked while
work items or workflow configuration reference a state. Retained topology
editors select a type/start state and add/remove destinations or workflow
states; changes that delete configuration require an impact confirmation, and
Cancel abandons that confirmation. These editor paths are source/component
coverage only because they are not currently mounted in production.

The guide derives the current configured stages, their actual destinations
and launch instructions, including a current state outside configuration.
Custom stage names remain custom; instructions are inert text. It explains
that saving a Story does not launch an agent and that provider activation or a
binding does not guarantee launch readiness. Loading, unavailable workflow
and provider errors are visible with Retry. It follows authoritative changes,
dismisses on selection switch/deletion/retyping and restores the surviving
trigger on user close. Opening it starts no work.

## Verifying it

Use `Configure Grill state`, region `Grill state configuration` and
`state-configuration-panel`; scope `Prompt`, `Skills` (Stage skills), `Required skills`, `Agent/provider`,
`Codex profile`, `Model`, `Reasoning`, `Auto-start Grill`, `Run subtree Grill`,
`Agents may move Grill to Spec` and `Handoff Grill to Spec` to that panel.
Read back the project's type `workflow_revision`, start state, transitions
(`agent_allowed`, `handoff`) and launch bindings through the generated
operations, then close/reopen and reload. Observe the ticket's `state-picker`
and authoritative WorkItem state after a move. Catalog component selectors
include `State catalog`, `State name`, `State group`, `State color for <name>`,
`Move <name> earlier`, `Move <name> later`, `Delete <name>` and `Start State`.

- `studio/e2e/web-app.spec.ts` covers persisted Grill prompt/options,
  permissions, handoff, auto-start and subtree flags with reload and invalid
  model refusal. Run `bun run --cwd studio test:e2e -- e2e/web-app.spec.ts -g "persists the Story Grill policy through Rust"`.
  Its `refuses a Story move outside the published workflow until an edge exists`,
  `reorders issue types through Rust and reorders the visible type picker`,
  `renames and recolours a state through Rust and converges the open tree`,
  `creates an issue type, moves its start state, and deletes it by reassigning`,
  `guards State deletion and converges the removal into the open tree` and
  `prunes a disposable workflow when its only reachable edge is deleted` test
  GraphQL/catalog convergence, not a catalog editor reached from Settings.
  Select an individual title with the same command's `-g`.
- The same spec's MCP convergence and `keeps a human-only workflow edge closed to the Rust MCP agent`
  cases cover agent-origin permission refusal and UI state convergence. Run
  `bun run --cwd studio test:e2e -- e2e/web-app.spec.ts -g "human-only workflow edge"`.
  `studio/e2e/work-management-guards.spec.ts` covers State validation and
  exact-project-set state/type reorder refusals: `bun run --cwd studio test:e2e -- e2e/work-management-guards.spec.ts`.
- `studio/src/test/overhaulWorkflowSettingsAcceptance.test.tsx` has
  overhaul-19 (state-delete blockers) and overhaul-244 (incoming/outgoing
  handoff controls), plus catalog loading cases. Run
  `bun run --cwd studio test -- src/test/overhaulWorkflowSettingsAcceptance.test.tsx`.
- `studio/src/test/overhaulLaunchBindingRuntimeAcceptance.test.tsx` covers
  overhaul-80 (revision conflict, authoritative reload and preserved hidden
  required skills). `studio/src/test/overhaulLaunchConfigurationConvergenceAcceptance.test.tsx`
  covers overhaul-246/262/263 (optimistic writes, reopening and refresh).
  Run `bun run --cwd studio test -- src/test/overhaulLaunchBindingRuntimeAcceptance.test.tsx src/test/overhaulLaunchConfigurationConvergenceAcceptance.test.tsx`.
- `studio/src/test/overhaulWorkflowStageSkillsAcceptance.test.tsx` covers
  overhaul-243 and unknown names, blur, duplicates, removal, empty selection
  and save errors. `studio/src/test/overhaulWorkflowStageSkillSerializationAcceptance.test.tsx`
  covers overhaul-328/329 (rapid additions/removal use refreshed revisions).
  Run `bun run --cwd studio test -- src/test/overhaulWorkflowStageSkillsAcceptance.test.tsx src/test/overhaulWorkflowStageSkillSerializationAcceptance.test.tsx`.
- `studio/src/test/overhaulWorkflowStageSkillAvailabilityAcceptance.test.tsx`
  covers overhaul-793–801: Review-stage names on open (`Interaction-design`
  available as `interaction-design`, `structure-review` missing with searched
  roots), add/remove refresh, Recheck without writes, provider/default changes,
  stale responses, unresolved/failed checks, case canonicalization and duplicate
  collapse on save, missing-skill saves, and the reachable panel over the real
  `LaunchSkillAvailability` query. Run
  `bun run --cwd studio test -- src/test/overhaulWorkflowStageSkillAvailabilityAcceptance.test.tsx`.
  The Rust contract is `cargo test -p ticketry-provider --test skill_availability`
  (roots, overrides, `.system`, symlinks, case matching, unreadable roots, no
  writes) and `cargo test -p ticketry-work-management --test launch_skill_availability`
  (agent/profile/default provider resolution, unlinked module), run from
  `studio/src-tauri`.
- `studio/src/test/overhaulStoryWorkflowGuideAcceptance.test.tsx` covers
  overhaul-373–385: Details entry, actual/custom/branching stages, outside
  state, provider/binding distinctions, selection guards, focus/Escape,
  retry, reactive changes and loading. Run
  `bun run --cwd studio test -- src/test/overhaulStoryWorkflowGuideAcceptance.test.tsx`.
  `studio/src/test/overhaulOnboardingCompletionAcceptance.test.tsx` covers
  overhaul-386/389/390 for tour entry, optional help failure and current-stage
  guidance; run `bun run --cwd studio test -- src/test/overhaulOnboardingCompletionAcceptance.test.tsx`.
- `studio/src/test/overhaulWorkflowRequiredSkillAvailabilityAcceptance.test.tsx`
  covers overhaul-802–808: existing Required skills, provider-specific status,
  searched-location warnings and Recheck, exact identifier spelling,
  cross-field preservation, save/reload, catalog refusal and reachable-panel
  read-only GraphQL checks. Run
  `bun run --cwd studio test -- src/test/overhaulWorkflowRequiredSkillAvailabilityAcceptance.test.tsx`.
  These Studio cases use the host-check / Apollo-GraphQL seams; the provider
  filesystem tests above establish that physical skill directories are not
  written. They do not establish installed-desktop behavior.
- Edition seeding: Pocock `project_create_returns_the_aggregate_after_seeding_reviewed_defaults`,
  `fresh_install_projects_persist_and_read_the_reviewed_state_colors` and
  `a_fresh_installation_project_has_its_reviewed_catalog` return early under core;
  core `core_project_create_seeds_only_the_module_type` and
  `core_fresh_install_and_created_projects_hold_only_the_module_type` read the
  catalog back through public GraphQL. Run
  `cargo test --manifest-path studio/src-tauri/Cargo.toml --features edition-core --test work_management_schema_contract --test reviewed_default_colors`.
- Edition startup adoption: `final_schema_migration_chain` asserts the same
  ledger creation order and the recorded schema
  (`studio/src-tauri/tests/final_schema_migration_chain/final_schema.txt`) in
  both editions, with adopted data under Pocock and untouched data under core.
  Pocock `adopts_only_exact_former_reviewed_defaults_across_projects_and_reopens_stably`,
  `production_startup_adopts_old_colors_before_generated_state_reads` and
  `pocock_entry_skill_adoption_fills_only_unset_reviewed_stage_skills` return
  early under core; core `core_records_the_color_checkpoint_without_rewriting_any_state`,
  `core_production_startup_keeps_former_reviewed_colors` and
  `core_entry_skill_checkpoint_leaves_every_binding_unchanged` return early
  under Pocock. Run `cargo test --manifest-path studio/src-tauri/Cargo.toml
  --test final_schema_migration_chain --test workflow_color_adoption --test
  work_management_adoption`, then again with `--features edition-core`.
  Regenerate the recorded schema with `TICKETRY_BLESS_FINAL_SCHEMA=1` only when
  a chain step deliberately changes it.
- `studio/src/test/overhaulCoreEmptyWorkflowAcceptance.test.tsx` covers the core
  `No workflow yet` Stories state; run `bun run --cwd studio test -- src/test/overhaulCoreEmptyWorkflowAcceptance.test.tsx`.
- `studio/e2e-desktop/README.md` documents the disposable provider's MCP
  Implement → Review → Done moves, visible UI observation, reload and process
  restart persistence. Run `bun run --cwd studio test:e2e:desktop` on macOS;
  this is the authored fixture-execution path, not paid-provider proof.

The feature suite authors browser journeys for the Details guide, Stage and
Required skills, real disposable module skill directories, revision conflicts
and guarded policy writes. Retained catalog/topology editors remain unmounted;
the migrated catalog cases exercise public GraphQL and visible convergence.
The case-isolated suite uses first-run profiles: the tour case walks provider,
module and Story onboarding, while ordinary cases provision and acknowledge
real provider/catalog state before creating their existing fixtures. That
first-run setup has a bounded 90-second hook budget; browser cases and assertions
retain the normal Playwright deadlines.
Runtime results and passing claims belong to the feature runner's recorded run.

## End-to-end suite

Suite: studio/e2e/features/workflows-and-issue-types.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `workflow-map-issue-types` | @case-workflow-issue-type-reorder @case-workflow-issue-type-lifecycle | @case-workflow-type-picker-choices | @case-workflow-issue-type-reorder-guard @case-workflow-story-birth-state | n/a: Pocock projects always seed task types; the core Module-only catalog is covered by Rust and Vitest evidence above, not a browser case | @case-workflow-type-picker-choices | @case-workflow-issue-type-reorder @case-workflow-issue-type-lifecycle |
| `workflow-map-state-catalog` | @case-workflow-state-catalog-reorder @case-workflow-state-rename-recolour | n/a: retained catalog draft and deletion-confirmation editors have no production mount | @case-workflow-state-delete-guard @case-workflow-state-name-guard @case-workflow-state-group-guard @case-workflow-state-reorder-guard @case-workflow-missing-identity-guard | @case-workflow-unused-state | @case-workflow-unused-state | @case-workflow-state-catalog-reorder @case-workflow-state-rename-recolour @case-workflow-state-delete-guard |
| `workflow-map-transitions` | @case-workflow-transition-listing @case-workflow-prune-unreachable-edge | n/a: topology impact confirmations have no production mount; mounted policy flags apply immediately | @case-workflow-move-outside-published-edges @case-workflow-transition-listing @case-workflow-revision-conflict | @case-workflow-transition-listing @case-workflow-unused-state | @case-workflow-transition-listing | @case-workflow-transition-listing @case-workflow-move-outside-published-edges @case-workflow-prune-unreachable-edge |
| `workflow-map-agent-permissions` | @case-workflow-agent-permission @case-workflow-grill-policy | n/a: permission and handoff flags apply immediately, without a cancelable draft | @case-workflow-agent-permission @case-workflow-revision-conflict | @case-workflow-transition-listing | @case-workflow-agent-permission | @case-workflow-agent-permission @case-workflow-grill-policy @case-workflow-revision-conflict |
| `workflow-map-launch-bindings` | @case-workflow-grill-policy @case-workflow-launch-profile | n/a: picker changes and blurred prompt edits apply immediately; closing does not roll them back | @case-workflow-grill-policy @case-workflow-binding-prompt-guard @case-workflow-launch-binding-conflict | @case-workflow-binding-prompt-guard | @case-workflow-grill-policy @case-workflow-binding-prompt-guard | @case-workflow-grill-policy @case-workflow-launch-profile @case-workflow-launch-binding-conflict |
| `workflow-map-entry-automation` | @case-workflow-grill-policy @case-workflow-binding-prompt-guard | n/a: automation flags apply immediately, without a cancelable draft | @case-workflow-binding-prompt-guard @case-workflow-automation-provider-guard | @case-workflow-binding-prompt-guard | @case-workflow-grill-policy @case-workflow-binding-prompt-guard | @case-workflow-grill-policy @case-workflow-binding-prompt-guard |
| `workflow-map-stage-skills` | @case-workflow-stage-skills | n/a: Enter or blur commits a tag and removal applies immediately | @case-workflow-stage-skills | @case-workflow-stage-skills | @case-workflow-stage-skills | @case-workflow-stage-skills |
| `workflow-map-stage-skill-availability` | @case-workflow-skill-availability | n/a: read-only checks have no cancel action | @case-workflow-skill-availability | @case-workflow-stage-skills | @case-workflow-skill-availability | @case-workflow-skill-availability |
| `workflow-map-required-skills` | @case-workflow-required-skills | n/a: Enter or blur commits a tag and removal applies immediately | @case-workflow-required-skills | @case-workflow-required-skills | @case-workflow-required-skills | @case-workflow-required-skills |
| `workflow-map-story-guide` | @case-workflow-story-guide @case-workflow-tour-guide | @case-workflow-story-guide @case-workflow-tour-guide | @case-workflow-story-guide | @case-workflow-story-guide | @case-workflow-story-guide @case-workflow-tour-guide | @case-workflow-story-guide @case-workflow-tour-guide |

## Relevant code

- `studio/src/features/workflows`: the complete workflow domain, including
  catalog/topology editors, state policy, launch picker/validation, Stage and Required skills,
  guide, Apollo projections, mutation transport and generated operations.
  `skillAvailability/` holds the availability query transport, stale-safe hook
  and save-time name canonicalization; other features read its
  `SkillAvailabilityResult` type only through the `features/workflows` entrypoint;
  `studio/src/features/workflows/SkillAvailabilitySummary.tsx` renders the
  status and Recheck. Required-skill saves preserve exact identifiers rather
  than applying Stage skills' save-time canonicalization.
- `studio/src-tauri/crates/foundation/ticketry-provider/src/skill_availability`:
  the read-only provider root and SKILL.md matching contract.
  `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/launch_binding/skill_availability`:
  provider/module-folder resolution and the `launch_skill_availability` query.
- `studio/src/features/studio/modals/SettingsModal.tsx`: current Settings rail;
  `studio/src/app/shell/ticket-workspace/tasks/components/StateHeaderRow.tsx`:
  production Configure entry.
- `studio/src/app/shell/ticket-workspace/selected-ticket/SelectedTicket.tsx`:
  state overlay host; `studio/src/app/shell/ticket-workspace/selected-ticket/details/StoryWorkflowGuideAction.tsx`:
  Details guide trigger; `studio/src/app/onboarding/OnboardingTour.tsx`: tour trigger.
- `studio/src/app/modal/StoryWorkflowGuideModal.tsx` and
  `studio/src/app/modal/openStoryWorkflowGuide.ts`: guide modal lifecycle/focus.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/workflow`:
  revision, membership, transition and launch-policy enforcement.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/default_project_catalog.rs`:
  edition-chosen seed catalog for created and installation projects.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/workflow_color_migration.rs`
  and `launch_binding_entry_skill_migration.rs`: Pocock-only default adoption
  inside checkpoints that every edition records.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/launch_policy`:
  launch resolution, auto-start and skill composition.
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/work_item/views/update`:
  exclusive WorkItem state patch; `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/issue_type`:
  type CRUD and workflow pruning; `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/state`:
  catalog CRUD/ordering.

## Gotchas

Follow [CLAUDE.md](../../CLAUDE.md): identity-bound, allowlisted GraphQL writes
must use the restricted model contract. A WorkItem state transition is an
exclusive patch; do not combine it with name, parent, blockers or unrelated
fields. Agent-origin moves still obey configured edges and `agent_allowed`;
a permitted human move does not prove the same agent move is permitted.
`human_only_transition` is a refusal, not an edge to bypass. Use the
[route/operation registry](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/graphql/operation_registry.rs)
for the actual CRUD and documented exception surface.

Wait for workflow reads and applied writes; opening Settings currently loads
Models, not workflow catalogs. Read revisions again after every topology or
policy write. A catalog state is not automatically a member of every type's
workflow, and state-group Configure only exposes eligible task-level types.
The source-only retained editors are not evidence of reachable Settings tabs.

The guide's familiar-stage explanations supplement configured data; they do
not promise a fixed Ideas → Done pipeline, which only Pocock seeds. Root Rust
suites and browser journeys that create work items in a fresh project assume
the reviewed catalog and pass only under Pocock until CODING-2790 lands. Launch settings, entry automation,
transition permission and handoff are separate controls. Browser state-policy
editing cannot prove desktop launch/delivery. Live or installed behavior beyond
the cited tests is unverified by this map-authoring task.
