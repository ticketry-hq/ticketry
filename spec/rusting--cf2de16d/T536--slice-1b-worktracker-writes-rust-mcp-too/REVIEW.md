# Slice 1b review: model-shaped writes versus operation-shaped mutations

This is the durable review record for the Rust WorkTracker write surface in
CODING-536. It focuses on one architectural failure mode: exposing a new
transport mutation or DAO-style handler for each way a caller can change a
model, instead of exposing a restricted model-shaped write and keeping the
invariant-maintenance code behind that boundary.

The conclusion is not that reparenting, blocker validation, pruning, revision
allocation, or archive cascades should become raw database updates. Those are
necessary model operations. The problem is allowing their implementation shape
to multiply the public mutation surface.

## Review baseline

* Review date: 2026-08-12
* Fixed point: `HEAD` at `547b1bab7e93508762b29aa41e8d13545942fcff`
* Reviewed scope: the live working tree under
  `studio/src-tauri/src/work_management/`, its GraphQL projection, MCP
  projection, generated schema, and the accepted Django model-shaped contract
* Review axes: repository standards and specification completeness
* Status at capture: all findings are open
* The working tree changed concurrently during review. The final evidence below
  uses the newest files observed before this document was written. No concurrent
  implementation edits were reverted or rewritten.
* Snapshot SHA-256 values:
  * `command_schema.rs`: `4b9ae7bd6bc954b7e80bc7e99027ac8906b0740c59f7986611a16a3ef4b4e107`
  * `workflow_command_schema.rs`: `7901a77c072a8b66627908839f6e7eb2692cd039abf843b132ceaa60066b44e5`
  * `commands/catalog.rs`: `061aac234b0c84769040469dc20e2bbc428d58ae759ccd9a5db97ed4e61c4e72`
  * checked-in `schema.graphql`: `19a85ed03f29fd0dff9bb8c6a3aa296856e501ea5c7bdb5de9f4e7376b1a2f64`

Severity:

* **P1** — resolve before this write surface becomes the shipping authority
* **P2** — resolve in the same slice before final handoff
* **P3** — cleanup that may follow once the boundary is corrected

## Review rule

An authored mutation may be model-shaped without being unsafe generated CRUD.
The intended boundary is:

```text
restricted authored input
        -> one model/controller operation and transaction
        -> invariant helpers
        -> authoritative result
```

The authored input must allowlist writable fields and preserve
`omitted | null | value`. Derived and protected fields remain absent. The model
operation, not the transport, owns validation, locking, revision allocation,
denormalized repairs, pruning, and event planning.

The accepted exceptional writes remain exceptional: work-item reorder, state
reorder, issue-type reorder, remove-state-from-workflow, and onboarding
acknowledgement. Transitioning state is also a meaningful internal model
operation, but the accepted public contract routes it through the sole
WorkItem patch and refuses to mix it with unrelated fields.

## Standards

### ST-01 — WorkItem writes have fragmented into field-specific RPCs (P1, open)

The live GraphQL surface exposes basic WorkItem update separately from archive
and reparent in
[`command_schema.rs`](../../../studio/src-tauri/src/work_management/command_schema.rs),
then exposes transition, blocker replacement, additive blocker, and reverse
dependent writes in
[`workflow_command_schema.rs`](../../../studio/src-tauri/src/work_management/workflow_command_schema.rs).
The generated schema shows the same older split at
[`schema.graphql`](../../../studio/src/graphql-foundation/generated/schema.graphql).

That conflicts with the accepted definition of **Domain operation** in
[`CONTEXT.md`](../../../backend/worktracker/CONTEXT.md), which names exactly five
exceptions, and with
[`ADR 0005`](../../../backend/worktracker/docs/adr/0005-model-shaped-crud-with-quarantined-rpc.md),
where parent, state, and blockers are guarded fields on the one WorkItem patch.
CODING-536 requires explicit authored mutations, but it does not require one
public mutation per invariant helper.

Path to green:

1. Introduce one authored `UpdateWorkItemInput` with an explicit allowlist:
   `name`, `description`, `issue_type_id`, `parent_id`, `blocked_by_ids`, and the
   approved archive representation. Use a checked tri-state wrapper for nullable
   fields.
2. Keep `state_id + origin` on the same public WorkItem update route, but retain
   the existing rule that a state transition must be submitted alone.
3. In one controller transaction, dispatch supplied fields to the existing
   hierarchy, blocker, transition, archive, and classification model helpers.
   Do not let the caller write `module_id`, `rank`, revisions, timestamps,
   project identity, or derived counters.
4. Keep `reorder_work_item` as the declared exceptional positional operation.
5. Remove GraphQL `reparent_work_item`, `archive_work_item`,
   `set_work_item_blockers`, `add_work_item_blocker`, and
   `add_work_item_dependent` after Studio callers migrate.
6. Preserve legacy MCP tool names as compatibility adapters; they call the same
   controller rather than defining a second canonical mutation surface.

Green evidence:

* an exact mutation-registry test contains one WorkItem create/update/delete and
  the declared reorder exception;
* differential tests cover omitted, null, unchanged, invalid, and mixed-state
  patches;
* reparent and blocker invariant tests continue passing through the unified
  update entrypoint.

### ST-02 — Persisted workflow rows are exposed as bespoke actions (P1, open)

[`workflow_command_schema.rs`](../../../studio/src-tauri/src/work_management/workflow_command_schema.rs)
publishes `add_issue_type_transition`,
`set_issue_type_transition_permission`, `remove_issue_type_transition`,
`set_issue_type_start_state`, `upsert_issue_type_launch_binding`,
`delete_issue_type_launch_binding`, `set_issue_type_launch_auto_start`, and
`set_issue_type_launch_subtree_run`.

Transition and LaunchBinding records are persisted rows. ADR 0005 explicitly
classifies transition rows as ordinary CRUD, start state as a revision-guarded
IssueType update, and only removal of a reachable workflow member as a true
exception. Separate `set_*` mutations for individual LaunchBinding fields are
the same anti-pattern as separate reparent and blocker mutations.

Path to green:

1. Expose authored, row-shaped transition mutations:
   `create_issue_type_transition`, `update_issue_type_transition`, and
   `delete_issue_type_transition`.
2. Move `start_state_id` and `workflow_revision` into the restricted
   `update_issue_type` input. Keep reachability validation and pruning inside
   the IssueType model operation.
3. Keep one composite-key LaunchBinding upsert/update and one delete. Its patch
   input includes `prompt`, `required_skills`, `model_id`, `reasoning_id`,
   `auto_start`, and `subtree_run_enabled` with tri-state presence.
4. Remove the public auto-start and subtree-run convenience mutations. MCP
   compatibility tools translate to the row-shaped controller.
5. Retain `remove_state_from_issue_type_workflow` as the named exception because
   workflow membership is reachability, not a row.

Green evidence: an exact public mutation inventory maps each persisted row to
create/update/delete and separately lists only the five accepted domain
operations.

### ST-03 — MCP adapters contain a second implementation of domain sequencing (P1, open)

The target blueprint requires GraphQL and MCP to invoke shared controllers.
Instead:

* [`dependency_tools.rs`](../../../studio/src-tauri/src/work_management/mcp/dependency_tools.rs)
  reads blocker state, constructs a replacement set, and then writes it;
* [`workflow_tools.rs`](../../../studio/src-tauri/src/work_management/mcp/workflow_tools.rs)
  reads and reconstructs a LaunchBinding before upserting it;
* [`dispatch.rs`](../../../studio/src-tauri/src/work_management/mcp/dispatch.rs)
  implements review-finding parent/type/state/evidence policy before calling
  ordinary WorkItem creation;
* append-description similarly reads, concatenates, and updates outside one
  controller transaction.

These are not merely transport projection. They decide mutation semantics and
create time-of-check/time-of-use windows. They violate the blueprint boundary
that a resolver authenticates/normalizes, delegates once, and projects.

Path to green:

1. Create shared controller inputs for atomic blocker add/replace, description
   append, review-finding creation, and LaunchBinding patch.
2. Move all query-plus-decision-plus-write sequences into those controllers.
3. Leave MCP responsible only for authorization, legacy identifier/name
   resolution where required by its wire contract, one controller call, and
   result-envelope projection.
4. Route GraphQL through those same controllers. Do not have MCP invoke GraphQL
   or GraphQL invoke MCP.

Green evidence: a source-level boundary test rejects SeaORM entity/query imports
from MCP handler modules, and each mutating tool has one controller invocation.

### ST-04 — There is no exact reasoned Rust mutation registry (P1, open)

During this review, source gained onboarding and catalogue update/delete/reorder
mutations plus `set_issue_type_launch_subtree_run`, while the checked-in SDL
temporarily lacked all nine. The SDL was regenerated after the finding, but the
mutation test in
[`work_management_commands.rs`](../../../studio/src-tauri/tests/work_management_commands.rs)
only asserts that an old subset is contained in the live schema; it does not
reject extra, duplicated, or unreasoned fields.

The following command caught the initial schema drift:

```text
npm run graphql:drift --workspace @worktracker/studio
```

It failed with `schema.graphql drift differs`. After concurrent regeneration,
a final rerun did not complete: the second generation pass reported that
`Cargo.lock` required an update while `--locked` was active. Therefore this
review does not claim a green final drift gate, even though the final observed
SDL includes the newly added source mutations.

Path to green:

1. Add a pure-data Rust write registry keyed by canonical model, mirroring the
   accepted route registry. Give every write one classification: model CRUD or
   one of the five named exceptions.
2. Assert two-way equality between that registry and GraphQL introspection;
   replace the current `fields.contains(...)` loop.
3. Assert that MCP compatibility tools map to registry/controller entries but
   do not expand the canonical mutation inventory.
4. Regenerate SDL, bindings, and feature operations only after ST-01 and ST-02
   settle the intended surface; otherwise generation merely freezes the wrong
   API.
5. Run the drift gate in CI and the final handoff suite.

### ST-05 — The fragmentation is producing duplication and oversized transport modules (P2, open)

Project-revision allocation and locking are repeated in WorkItem update,
hierarchy, reorder, blocker, and transition command modules. A single logical
change to WorkItem update policy therefore requires shotgun edits. At review
time, `command_schema.rs` was 539 lines, `commands/catalog.rs` 671 lines,
`mcp/dispatch.rs` 464 lines, and `mcp/projection.rs` 440 lines, beyond the
repository's roughly 300–400-line governing limit.

Path to green:

1. Give WorkItem and workflow controllers transaction ownership and shared
   revision-allocation primitives.
2. Keep invariant helpers focused (`hierarchy`, `blockers`, `transition`,
   `ranking`) and callable inside an existing transaction.
3. Split GraphQL projection by canonical model/capability, not by a growing
   bucket of one-off mutations.
4. Split MCP dispatch and projection by capability while keeping policy in the
   controllers.

This is partly a code-smell judgement call, but the file-size requirement is a
documented hard standard.

## Spec

### SP-01 — Additive blocker helpers can lose concurrent updates (P1, open)

GraphQL `add_work_item_blocker` reads the current list and later calls
replacement. MCP `add_task_blocker` and `add_task_dependent` do the same from a
previously projected WorkItem. Two concurrent additions can both validate old
state and the last replacement can erase the other. GraphQL also appends an
already-present edge and then fails duplicate validation rather than behaving
idempotently.

CODING-536 requires concurrent blocker updates to produce one valid committed
result and says reverse helpers must use the same command.

Path to green:

1. Replace `list/read -> append -> replace` adapters with one internal
   `BlockerChange::{Replace, Add, Remove}` command.
2. Acquire the project writer reservation before reading the current edge set.
3. Validate endpoint scope and cycles against the graph in that transaction.
4. Make `Add` idempotent and allocate one revision only when the relationship
   actually changes.
5. Use the command from the unified WorkItem patch and all legacy MCP blocker
   tools; remove the GraphQL additive conveniences.

Green evidence: a multi-connection test concurrently adds two different
blockers and the committed set contains both; repeated add is a no-op.

### SP-02 — LaunchBinding omission semantics overwrite existing fields (P1, open)

The GraphQL upsert accepts several optional arguments but maps omissions to an
empty skill list, `None`, or `false` before calling
[`launch_policy.rs`](../../../studio/src-tauri/src/work_management/commands/workflow/launch_policy.rs).
That operation then overwrites every field. The MCP adapter attempts to preserve
values by reading the row first, but does so outside the write transaction.
Current Django PATCH semantics preserve omitted fields, and CODING-536 says
that behavior wins.

Path to green:

1. Define `PatchValue<T> = Unset | Null | Value(T)` at the view-contract seam.
2. Lock and load the current composite-key row inside the LaunchBinding
   controller transaction.
3. Merge only supplied fields, then validate the complete proposed row once.
4. Create a missing row only when its required create fields are available.
5. Advance the workflow revision only for an actual change.

Green evidence: per-field tests cover omission, explicit null, empty, unchanged,
and invalid combinations through both GraphQL and MCP.

### SP-03 — Generic catalogue patches bypass the declared reorder operations (P1, open)

The live `UpdateState` and `UpdateIssueType` inputs in
[`catalog.rs`](../../../studio/src-tauri/src/work_management/commands/catalog.rs)
expose `sort_order` and assign it directly, while the same module also provides
atomic complete-order operations. The GraphQL projection exposes both paths.
This is the inverse of the main anti-pattern: a generic update is too permissive
and bypasses a genuine domain operation.

Path to green:

1. Remove `sort_order` from both generic update inputs and GraphQL arguments.
2. Keep state and issue-type reorder as the only public order writes.
3. Validate that `ordered_ids` is an exact, duplicate-free, project-scoped set
   and rewrite all positions in one transaction, as the dedicated operations
   already intend.
4. Add negative schema tests proving `sort_order` is not patchable.

### SP-04 — Review-finding creation has been reimplemented in the MCP transport (P1, open)

[`dispatch.rs`](../../../studio/src-tauri/src/work_management/mcp/dispatch.rs)
checks repository paths and ranges, reads the parent's type and state, chooses
the Implementation type, constructs the description, and only then calls
ordinary WorkItem creation. Parent state can change after the check, and another
transport would need to duplicate the same policy.

The accepted Django design absorbs review findings into WorkItem create while
retaining a server-side gate. CODING-536 also requires MCP and GraphQL to share
commands.

Path to green:

1. Add a typed review-finding create variant to the WorkItem controller, not a
   separate canonical persisted model.
2. Lock/read the parent and validate parent project, Story type, Review state,
   evidence, derived Implementation type, and birth state in the create
   transaction.
3. Have the legacy MCP tool normalize its arguments and call that controller
   once. If Studio needs the behavior, call the same WorkItem create variant.

Green evidence: changing the parent concurrently cannot create an invalid
finding, and the operation creates no blocker or launch side effect.

### SP-05 — The authored write set is still incomplete (P1, open)

The newest source covers more Project, State, and IssueType CRUD than the
checked SDL, but CODING-536 requires the complete current write closure.
Remaining clear gaps include Module creation/edit/archive/delete and writable
Provider, AgentModel, and ReasoningLevel catalogue operations. Current
`create_work_item` resolves only task-level types, so it cannot serve the Module
write contract as written.

Path to green:

1. Derive the required write inventory from the accepted route registry and
   CODING-536 ownership manifest, model by model.
2. Add the missing restricted authored CRUD operations; do not fill the gap with
   per-field RPCs.
3. Keep Module structural invariants and catalogue PROTECT checks inside model
   operations.
4. Require exact registry-to-GraphQL equality before declaring the write set
   complete.

### SP-06 — Contract generation was not kept continuously green (P1, open)

The live Rust schema source and checked generated SDL disagreed during the
review, and the old contains-only schema test did not prevent the mismatch. The
drift command detected the stale SDL. The SDL was then regenerated concurrently,
but the final rerun stopped on a `Cargo.lock`/`--locked` error during its second
generation pass. The gate exists, but it was not kept green while the write
surface changed and its final state remains unverified.

Path to green:

1. Resolve ST-01 through SP-05 first.
2. Regenerate the SDL, TauRPC bindings, operation types, and manifests.
3. Run the exact registry conformance test, `graphql:drift`, Rust command and
   transport tests, Studio typecheck, affected acceptance tests, and the
   mandated overhaul suite.

## Green target

The review is green when all of the following are true:

* Every persisted model has a small, explicit authored CRUD surface with a
  field allowlist; no raw generated entity mutator is enabled.
* The only non-CRUD public mutations are the five exceptions recorded in the
  accepted domain language.
* WorkItem parent, blockers, classification, archive, and state requests enter
  through one restricted update contract while their invariant helpers remain
  internal and transaction-safe.
* Transition and LaunchBinding rows are row-shaped CRUD; start state is an
  IssueType patch; order fields cannot bypass reorder operations.
* MCP retains its required 30-tool wire contract but every mutating tool is a
  thin adapter over the same controllers GraphQL uses.
* The mutation registry, live schema, generated artifacts, and Studio
  operations agree exactly.
* Concurrency tests prove blocker add, append, LaunchBinding patch, reparent,
  revision allocation, and pruning do not lose committed changes.

Standards summary: 5 findings; worst issues are the undeclared mutation
fragmentation and duplicated domain sequencing in transports. Spec summary: 6
findings; worst issues are the blocker lost-update path, LaunchBinding
omission-clobber behavior, and incomplete/stale public contract.