# ST-01 — cross-child integration notes

Coordination artifact for CODING-594. Written by the story-level session, not by
any Implementation child. Children CODING-605 → 609 should read this before
choosing a contract, and append to it when they resolve one of the open
decisions below.

Status at time of writing: all five Implementation children are in `Implement`;
none terminal. Nothing has landed to integrate yet. What follows is the shared
surface each child will collide with, plus four decisions that are not settled
by the story description and will otherwise be discovered late by CODING-609.

## The write surface, as it actually exists today

The WorkItem write surface spans **two** GraphQL roots, not one:

| Mutation                                                | File                                                     | Line |
| ------------------------------------------------------- | -------------------------------------------------------- | ---- |
| `create_work_item`                                      | `studio/src-tauri/src/work_management/command_schema.rs` | 225  |
| `update_work_item` (name, description, issue type only) | `command_schema.rs`                                      | 251  |
| `archive_work_item`                                     | `command_schema.rs`                                      | 273  |
| `reorder_work_item` *(declared exception — stays)*      | `command_schema.rs`                                      | 281  |
| `reparent_work_item`                                    | `command_schema.rs`                                      | 303  |
| `delete_work_item`                                      | `command_schema.rs`                                      | 325  |
| `transition_work_item`                                  | `workflow_command_schema.rs`                             | 20   |
| `set_work_item_blockers`                                | `workflow_command_schema.rs`                             | 50   |
| `add_work_item_blocker`                                 | `workflow_command_schema.rs`                             | 62   |
| `add_work_item_dependent`                               | `workflow_command_schema.rs`                             | 76   |

Backing invariant helpers, all under
`studio/src-tauri/src/work_management/commands/`:
`work_items.rs` (create/update/archive/delete), `hierarchy.rs` (reparent),
`blockers.rs` (replace/list), `workflow/transition.rs`, `reorder.rs`.

### Integration risk 1 — `workflow_command_schema.rs` is co-owned

CODING-607 is scoped as "Migrate GraphQL and Studio", but four of the mutations
it must remove live in `workflow_command_schema.rs`, whose remaining contents
(issue-type transitions, launch bindings, start state, `delete_state`) belong to
sibling story **ST-02 / CODING-595**. Two stories editing that file
concurrently is a live merge hazard.

Suggested split: CODING-607 moves the four WorkItem mutations *out* of
`workflow_command_schema.rs` in a single mechanical commit before touching
anything else, leaving that file purely issue-type/workflow-config. This also
follows the repo rule that a file holds one concern.

### Integration risk 2 — every helper owns its own transaction

This is exactly CODING-605's job, recorded here so 606 can rely on it. Each
helper currently calls `database.begin()` itself:

* `hierarchy.rs:44` · `blockers.rs:35` · `work_items.rs:124` (update),
  `work_items.rs:152` (archive), `work_items.rs:197` (delete) ·
  `workflow/transition.rs:39` · `reorder.rs:47`

`workflow/transition.rs` already has internal helpers taking
`&DatabaseTransaction` (lines 203, 238, 254) — that is the shape to generalise
to all of them: a `*_in(transaction, …)` core plus a thin
`begin() → *_in → commit()` wrapper for callers that still want one.

**Do not skip `reorder.rs`.** Reorder stays a declared exception at the GraphQL
boundary, but see decision D2 — if reparent must place a sibling atomically, the
controller needs the ranking core inside its own transaction.

## Coordination pass 2 — surface re-verified, decisions ratified

Re-checked against the tree: no commits since `547b1ba`, no dirty files under
`work_management/` or its `mcp/`. All five children are still in `Implement`;
nothing has landed to integrate. Every file and line reference in the table
above is still exact.

### Which mutations actually have Studio callers

Removal cost is not uniform, and CODING-607 is smaller than it looks. Counting
non-generated callers under `studio/src`:

| Mutation                                                                                                       | Studio callers |
| -------------------------------------------------------------------------------------------------------------- | -------------- |
| `create_work_item`, `update_work_item`, `reparent_work_item`, `transition_work_item`, `set_work_item_blockers` | 3 files each   |
| `add_work_item_blocker`, `add_work_item_dependent`, `archive_work_item`                                        | **0**          |

Those last three are GraphQL-only surface. Deleting them touches no frontend
code, so 607 should drop them first and unblock 609's registry test early.

### Integration risk 3 — `is_archived` is a DERIVED field, not a patch field

This is the one finding that changes the story description. In Django,
`is_archived` has **no write endpoint at all**: `rest/serializers.py:90,98,141`
expose it read-only, and the only writers are the state-transition boundaries in
`workflow.py:193-196` —

* entering the `cancelled` group → `True`, then `cascade_archive` over the whole
  task subtree (`work_items.py:44-59`);
* leaving the `cancelled` group → `False`, **item only** — descendants archived
  by the earlier cascade stay archived;
* any transition that crosses neither boundary → `is_archived` untouched.

So path-to-green step 1's "archive state with explicit omitted/null/value
semantics" cannot be honoured as written without making a derived field
caller-writable, which contradicts step 3 and the `CLAUDE.md` rule that derived
fields stay unwritable.

**Ratified: `is_archived` is not a member of `UpdateWorkItemInput`.** Archive is
a consequence of the transition branch, not a sibling of it. That also settles
D3's cascade question: unarchiving is item-only, never a subtree un-cascade.

`archive_work_item` (`command_schema.rs:273` → `commands/work_items.rs:143`) is
itself a divergence — an unconditional flag write with its own subtree cascade,
state-independent, with **zero callers anywhere**. It is dead code that
contradicts Django. CODING-607 deletes it; no replacement patch field is owed.

### Integration risk 4 — the Rust transition already breaks archive parity

`commands/workflow/transition.rs:164` writes `active.is_archived =
Set(new_cancelled)` unconditionally, while Django only writes on a boundary
crossing. Concrete divergence: take an item archived as a descendant of a
cancelled parent, then transition it between two non-cancelled states. Django
leaves it archived; Rust silently un-archives it.

The fix belongs in this story — 605 owns making the transition helper
transaction-composable and 606 owns the branch that calls it — and it must land
*before* CODING-609 writes its differential test, or 609 will encode the buggy
behaviour as expected. Correct shape mirrors Django: only assign `is_archived`
inside the two boundary branches; leave it untouched otherwise.

## Open decisions — D1, D2, D4 ratified below

These need one answer shared across 606, 607, 608, and 609. **D3 is now closed
by integration risk 3 above.** D1, D2, and D4 are ratified as follows, so no
child should re-litigate them:

* **D1** — take the recommendation: drop `add_work_item_dependent` from GraphQL
  (0 Studio callers), keep MCP `add_task_dependent` as an adapter that issues
  one unified update *against the dependent*. Same for `add_work_item_blocker`.
* **D2** — take option 1: the patch carries optional `before_id`/`after_id`
  alongside `parent`. It is the only option that keeps 609's
  differential-vs-Django test passing unmodified, and it is why 605 must include
  `reorder.rs` in its transaction-composable pass.
* **D4** — yes, make create symmetric (`CreateWorkItemInput`). It is a
  mechanical change in 606 and avoids a special case in 609's exact-registry
  assertion.

### D1 — What happens to `add_work_item_dependent`?

`workflow_command_schema.rs:76` writes the **inverse** edge: given `id` and
`dependent_id`, it appends `id` to *`dependent_id`'s* `blocked_by`. It is not
expressible as a patch on the target item's `UpdateWorkItemInput`, because the
row it mutates is a different work item. The path-to-green enumerates
"blocked-by IDs" only, and is silent on this one.

Recommendation: drop it from GraphQL entirely; keep the MCP name
`add_task_dependent` (`mcp/registry.rs:44`) as an adapter that reads the
dependent's blockers and issues one unified update **against the dependent**.
No new exception is needed. CODING-609's exact-registry test should assert its
absence.

### D2 — Does the unified patch accept sibling placement on reparent?

`reparent_work_item` takes `before_id` / `after_id`
(`command_schema.rs:303-309`); the proposed input covers `parent` only.

Three options, and they are not equivalent:

1. Patch carries optional placement alongside `parent` — atomic, matches Django,
   but blurs the boundary against the reorder exception.
2. Reparent then reorder as two calls — non-atomic, and a visible behaviour
   change (an item is briefly at a default rank under its new parent).
3. Reparent always lands at a deterministic default rank; placement is a
   separate explicit reorder.

Option 1 preserves current behaviour and is the only one CODING-609's
differential-vs-Django test will pass unmodified. If 606 picks anything else,
say so here and adjust the acceptance evidence deliberately rather than letting
the test discover it.

### D3 — Is archive becoming two-way?

`work_items.rs:143` exposes `archive` only; there is no unarchive path. The
plan's "archive state with explicit omitted/null/value semantics" implies a
settable boolean, i.e. **new** unarchive behaviour plus its own cascade rules
(does unarchiving a parent unarchive the subtree it archived?). Confirm the
Django semantics before 606 implements, and state the cascade rule here.

### D4 — Does `create` also become an input object?

`create_work_item` takes six flat arguments. Introducing `UpdateWorkItemInput`
as an object while create stays flat makes the "one model-shaped
create/update/delete core" asymmetric. CODING-609's registry test needs to state
whether symmetry is required; cheaper to decide now than to reshape create late.

## MCP adapter constraints for CODING-608

Two MCP tools do not map one-to-one onto a single-item unified update:

* **`reparent_tasks`** (`mcp/registry.rs:100`) is **bulk** and its documented
  return is `{parent_task_id, reparented, skipped, failed}` — a partial-success
  contract. It must not become all-or-nothing under one controller transaction.
  Loop per item, one transaction each, and keep collecting failures.
* **`append_task_description`** (`mcp/registry.rs:47`) is read-modify-write; the
  unified patch takes an absolute description. The adapter keeps the read.

Everything else (`update_task`, `update_task_status`, `set_task_blockers`,
`add_task_blocker`, `add_task_dependent`) is a thin field-mapping adapter, which
is what the story asks for.

## Coordination pass 3 — artifacts outside `work_management/`

Re-verified: still no commits past `547b1ba`, and nothing under
`studio/src-tauri/src/work_management/` has been touched since 08:08 — earlier
than pass 2 itself. All five children remain in `Implement`; still nothing to
integrate. Every line reference in the tables above is still exact.

This pass looked *outside* the Rust command modules, where four collision
surfaces live that passes 1 and 2 never named.

### Integration risk 5 — the mutation registry belongs to a sibling story

ST-01's acceptance evidence ("exact mutation-registry tests") and the sibling
story **CODING-597 `[ST-04] Add an exact reasoned Rust mutation registry`** both
call for the same artifact. It does not exist yet:
`reorder_work_item` appears in exactly one Rust file (`command_schema.rs:281`),
no test anywhere under `work_management/` asserts mutation names, and
`ownership_manifest.rs` is a *table/column* ownership list — a different axis,
not a mutation inventory. The only real registry is Django's
(`backend/worktracker/registry.py:313` `DOMAIN_OPERATIONS`, with the
both-directions conformance test `backend/worktracker/tests/test_route_registry.py`).

The two stories are ordered against each other in a cycle: ST-04's step 4
regenerates SDL *"after the surface is settled"* — and ST-01 is what settles it —
while ST-01's CODING-609 needs a registry to test against.

**Ratified split, so neither story blocks the other and no second registry is
born:** CODING-609 asserts an exact set over schema introspection scoped to the
**WorkItem mutations only**, as a local test — not a new pure-data project-wide
registry. ST-04 later absorbs that assertion into the real registry covering all
five documented exceptions. CODING-609 must not create a rival registry module.

### Integration risk 6 — generated SDL and authored operations are a hard gate

Removing mutations is not just a Rust edit. The committed snapshot
`studio/src/graphql-foundation/generated/schema.graphql:230-240` enumerates the
live WorkItem mutation surface, and `npm run graphql:drift`
(`studio/scripts/verify-generated.mjs:55`) fails the build on any drift in
`schema.graphql`, `taurpc.ts`, `operations.ts`, or the per-feature operation
manifests.

Exact worklist for CODING-607 in
`studio/src/features/work-items/operations/workItems.graphql`: rewrite
`UpdateWorkTrackerWorkItem` (line 59); delete `TransitionWorkTrackerWorkItem`
(65), `ReparentWorkTrackerWorkItem` (71), `SetWorkTrackerBlockers` (77); leave
`ReorderWorkTrackerWorkItem` (83), `CreateWorkTrackerWorkItem` (53) and
`DeleteWorkTrackerWorkItem` (89). There is no authored operation for
`archive_work_item`, `add_work_item_blocker`, or `add_work_item_dependent` —
independent corroboration of pass 2's zero-caller finding.

607 must run `npm run graphql:generate` in the same commit as its removals, and
609 should include a green `npm run graphql:drift` in its evidence.

### Integration risk 7 — D2 is task-shaped placement only (correctness hazard)

D2 stays ratified, but it needs a scope qualifier that pass 2 missed, because
`reorder` and `reparent` do **not** implement the same placement.

`commands/reorder.rs` branches hard on module type: it writes the **project**
row (`project::Column::ManualModuleOrder`, `reorder.rs:71-75`), flips the
project's ordering mode on first drag, validates an `initial_order_ids`
baseline against every active module (`reorder.rs:177-204`), and enforces three
guards — module-vs-module neighbours (`155-168`), no archived module
(`60-63`), and at least one neighbour (`55-58`).

`commands/hierarchy.rs` placement has **none** of that. There is no `r#type`
check anywhere in `reparent` (`hierarchy.rs:25-78`); placement goes straight to
`destination_rank` → `fractional_rank`. A module reparented with
`before_id`/`after_id` today silently takes the task path, skipping the mode
flip and all three guards.

That is a pre-existing divergence, but D2 would inherit it *and* make the
unified patch the only update path, so the blast radius grows. **Declared:
placement inside `UpdateWorkItemInput` is task-shaped only. Module placement
stays exclusively in the `reorder_work_item` exception.** CODING-606 either
rejects placement on a module-type target with a validation error, or routes it
to the module branch — it must not silently fractional-rank a module. CODING-609
should cover a module-with-placement patch explicitly.

### Integration risk 8 — do not read `OWNED_TABLES` as a patch allowlist

`ownership_manifest.rs` lists `is_archived` among the `worktracker_issue`
columns Rust may write. That is *table-level write ownership after the Django
handoff*, not caller-writability, and it is not in tension with integration
risk 3. `is_archived` stays out of `UpdateWorkItemInput`; the manifest entry
exists because the transition branch writes the column internally.

## Declared exception, unchanged

`reorder_work_item` remains the only WorkItem-scoped exception in the
route/operation registry. Nothing in this story adds another; if a child
believes it needs one, record the missing behaviour and the reason here first
(per the deviation rule in `CLAUDE.md`).