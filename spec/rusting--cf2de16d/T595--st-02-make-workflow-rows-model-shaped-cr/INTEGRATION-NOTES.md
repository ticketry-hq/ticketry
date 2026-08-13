# ST-02 — integration notes

Written by the CODING-595 story session while implementing directly (this story
has no Implementation children). Records what ST-02 landed, what it inherited
from a concurrently-running sibling, and two shared-fixture repairs other
sessions should not undo.

## Convergence with SP-02 (CODING-600)

SP-02 landed the tri-state launch-binding patch in the same minutes ST-02 was
renaming the workflow controllers. Both stories converged on the same shape
rather than duplicating it:

* `workflow::PatchValue<T>` (`Unset | Null | Value`) and
  `workflow::patch_launch_binding` are **SP-02's**; ST-02 kept them and deleted
  the flat `UpsertLaunchBinding`, `SetLaunchAutoStart`, and `SetLaunchSubtreeRun`
  inputs plus their `set_launch_*` functions.
* ST-02 owns the module split under `commands/workflow/`. `configuration.rs` is
  gone; its contents are now `revision_guard.rs`, `transition_rows.rs`,
  `start_state.rs`, and `membership.rs`. Anything importing
  `workflow::configuration::…` must import `workflow::revision_guard::…`.
* The GraphQL tri-state argument adapters SP-02 wrote inline in
  `workflow_command_schema.rs` now live in
  `work_management/graphql_patch_input.rs` so both mutation roots can use them.

## Resolves ST-01's integration risk 1

`workflow_command_schema.rs` is no longer co-owned. It holds only the
WorkItem-scoped writes ST-01 (CODING-594) is removing —
`transition_work_item`, `set_work_item_blockers`, `add_work_item_blocker`,
`add_work_item_dependent`. Everything issue-type/workflow-shaped moved to
`workflow_configuration_schema.rs`, registered as its own custom mutation root
in `work_management/schema.rs`. CODING-607 no longer needs to move anything out
first; it can delete from `workflow_command_schema.rs` directly.

## Two shared-fixture repairs

Both were breaking `cargo test --test work_management_commands` for every
session, not just this one.

1. `tests/work_management_commands.rs:115` — a JSON literal added to the
   `format!` fixture SQL used single `{`/`}`, which is a compile error in a
   format string. Braces are now doubled. Keep them doubled.
2. The launch-binding count after `create_project` was asserted over the whole
   table, so a new `upsert_issue_type_launch_binding` probe on the fixture
   project pushed it from 24 to 25. It now counts only bindings belonging to the
   newly created project's issue types, which is what the assertion means.

## Behaviour change worth knowing

Routing the removed per-field mutations through the one patch means a patch that
carries **only** automation flags against a state with no launch binding is
refused with `not_found` instead of creating an unconfigured row — the same
rejection the deleted `set_issue_type_launch_auto_start` produced. A patch that
supplies any of prompt, required skills, model, or reasoning still creates the
row, so no Studio save path changes.

## Studio failures this story did not cause

`npx vitest run` has three failures, all in provider-catalogue territory owned
by the settings slice, none touching workflow rows:

* `src/app/__tests__/moduleBoundaries.test.ts` — three imports reach into
  `features/settings/generated/{keybindings,providerCatalog}` without a public
  entrypoint.
* `src/test/LaunchDefaultPicker.test.tsx` — two reasoning-level cases render no
  `option` elements beyond "Provider default".

The rest of the suite (103 files, 455 tests) is green, as are
`cargo test --lib`, `--test work_management_commands`,
`--test work_management_graphql`, `--test work_management_shape_parity`,
`--test graphql_foundation`, and `npm run graphql:drift`.
