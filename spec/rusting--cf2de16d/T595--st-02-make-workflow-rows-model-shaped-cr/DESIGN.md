# ST-02 — workflow rows as restricted model-shaped CRUD

Design record for CODING-595. This story has no Implementation children, so the
story-level session implements it directly, test-first.

Source finding:
`spec/rusting--cf2de16d/T536--slice-1b-worktracker-writes-rust-mcp-too/REVIEW.md`
— ST-02 (P1).

## What was wrong

Two persisted rows — `IssueTypeTransition` and `LaunchBinding` — plus one
`IssueType` column (`start_state_id`) were exposed as eight bespoke actions on
the canonical GraphQL surface:

`add_issue_type_transition`, `set_issue_type_transition_permission`,
`remove_issue_type_transition`, `set_issue_type_start_state`,
`upsert_issue_type_launch_binding`, `delete_issue_type_launch_binding`,
`set_issue_type_launch_auto_start`, `set_issue_type_launch_subtree_run`.

ADR 0005 classifies transition rows as ordinary CRUD, start state as a
revision-guarded IssueType update, and only the removal of a reachable workflow
member as a true exception.

## Resulting public mutation surface

| Persisted row / field                   | Public mutation                                                  |
| --------------------------------------- | ---------------------------------------------------------------- |
| `IssueTypeTransition`                   | `create_issue_type_transition`                                    |
| `IssueTypeTransition.agent_allowed`     | `update_issue_type_transition`                                    |
| `IssueTypeTransition` (row)             | `delete_issue_type_transition`                                    |
| `IssueType.start_state_id`              | `update_issue_type` (guarded by `workflow_revision`)              |
| `LaunchBinding` (all caller-writable)   | `upsert_issue_type_launch_binding` (tri-state patch)              |
| `LaunchBinding` (row)                   | `delete_issue_type_launch_binding`                                |
| workflow membership (reachability)      | `remove_state_from_issue_type_workflow` — **declared exception**  |

Removed with no replacement: `set_issue_type_launch_auto_start`,
`set_issue_type_launch_subtree_run`. `auto_start` and `subtree_run_enabled` are
ordinary members of the one LaunchBinding patch.

### Row identity

Transition and launch-binding rows carry a surrogate `id`, but their natural key
is the one callers hold and the one the uniqueness invariant is written against:
`(issue_type_id, from_state_id, to_state_id)` for a transition and
`(issue_type_id, state_id)` for a launch binding. Update and delete bind that
non-null key into their filter, so the write stays identity-scoped without
forcing every caller to resolve a surrogate id first. `workflow_revision` is the
compare-and-set guard, not part of the identity.

### Tri-state presence

`workflow::PatchValue<T>` spells `Unset | Null | Value(T)`. It and
`patch_launch_binding` came from sibling story SP-02 (CODING-600), which landed
while this story was renaming the controllers; ST-02 kept them and removed the
flat inputs and the per-field `set_launch_*` functions. At the GraphQL boundary
the adapters in `graphql_patch_input.rs` carry `omitted | null | value` through
seaography's `CustomInputType`, because a plain `Option<T>` argument collapses
null into absent.

Semantics of `upsert_issue_type_launch_binding`:

* an absent field keeps the stored value; on create it takes the column default;
* a patch that changes nothing does **not** burn a workflow revision — the
  existing row id comes back and the revision the caller read still holds;
* a patch carrying **only** automation flags against a state with no binding is
  refused with `not_found`, exactly as the deleted
  `set_issue_type_launch_auto_start` did, so a toggle cannot conjure an
  unconfigured row. Supplying any of prompt, required skills, model, or
  reasoning still creates it.

## Invariants stay behind the boundary

Each write still runs one transaction that claims the workflow revision by
compare-and-set, validates that every referenced state belongs to the issue
type's project, and prunes now-unreachable transitions and launch bindings.
Those helpers move to `commands/workflow/revision_guard.rs`; nothing about them
becomes caller-visible.

`start_state_id` runs inside `update_issue_type`'s transaction and before the
name/colour/sort-order edit, because claiming the revision rewrites the row that
edit is derived from.

## Module split

`commands/workflow/configuration.rs` held five concerns in 295 lines. It is
replaced by:

| Module              | Concern                                                     |
| ------------------- | ----------------------------------------------------------- |
| `revision_guard.rs` | revision compare-and-set, project-state check, reachability pruning |
| `transition_rows.rs`| transition row create / update / delete                     |
| `start_state.rs`    | the start-state patch applied by `update_issue_type`         |
| `membership.rs`     | `remove_state` — the declared pruning exception              |
| `launch_policy.rs`  | the launch-binding patch and delete                          |

Callers that imported `workflow::configuration::…` import
`workflow::revision_guard::…` instead; the `workflow::` re-exports are
unchanged.

The GraphQL projection splits the same way. `workflow_command_schema.rs` keeps
only WorkItem-scoped writes, which sibling story ST-01 (CODING-594) owns; the
issue-type workflow rows move to `workflow_configuration_schema.rs`. This
resolves integration risk 1 recorded in
`spec/rusting--cf2de16d/T594--st-01-unify-workitem-writes-behind-one-r/INTEGRATION-NOTES.md`
from this story's side: neither story needs to edit the other's file.

## MCP and Studio keep their contracts

The 30-tool MCP inventory is frozen by
`mcp/registry.rs::registry_has_the_legacy_thirty_tool_contract`, so
`set_issue_type_workflow_auto_start` and `set_issue_type_workflow_start_state`
survive as compatibility tools. They become thin translations onto the
row-shaped controllers — the launch-binding tool loses its read-modify-write
preamble entirely, because `PatchValue::Unset` now expresses "keep".

Studio keeps its REST transport unchanged for browser mode. On the desktop
GraphQL path, `setIssueTypeWorkflowAutoStart` and
`setIssueTypeWorkflowSubtreeRun` issue the one launch-binding patch with only
that flag present, and `setIssueTypeWorkflowStartState` issues
`update_issue_type`.

## Acceptance evidence

* `graphql_exposes_only_authored_mutations_and_structured_errors` asserts, by
  schema introspection, the exact set of issue-type workflow mutations — the
  three transition operations, the two launch-binding operations, and the one
  declared exception — and that no mutation name starts with `set_issue_type`.
  It also proves `update_issue_type` refuses a start-state patch without
  `workflow_revision`, and that the transition operations keep their CAS.
* `transition_rows_reject_stale_revisions_and_unknown_rows` covers a missing row
  on update, a successful revision-guarded update, and a stale delete that
  leaves the row intact.
* `automation_flags_ride_the_launch_binding_patch_and_need_a_configured_binding`
  covers the `not_found` refusal for a flags-only patch against a state with no
  binding, and both flags being set through the one patch afterwards.
* `launch_binding_patch_preserves_omitted_fields_and_skips_noop_revision`
  (SP-02's) covers omitted-field preservation and the no-op revision skip.
* `workflow_configuration_compare_and_set_is_atomic_and_prunes_unreachable_policy`
  now drives start state through `catalog::update_issue_type` and still asserts
  the pruning and the revision arithmetic.
* `npm run graphql:drift` is green, so the committed SDL and operation
  manifests match the new surface.
