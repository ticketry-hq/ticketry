# Seaography default hooks and override audit

Date: 2026-08-13

## Question

Where is Ticketry replacing generated Seaography behavior that the pinned
framework already supplies, and where do the pinned APIs genuinely require a
restricted custom seam?

This note is intentionally version-specific. Ticketry pins Seaography
`2.0.0-rc.9` and SeaORM `2.0.1` in
`studio/src-tauri/Cargo.toml`. The published Seaography crate identifies its
source revision as
[`d530a9ff`](https://github.com/SeaQL/seaography/tree/d530a9ff801e51cec4bf82bebb9e68a5af977bf2),
and SeaORM 2.0.1 identifies
[`b194ee0c`](https://github.com/SeaQL/sea-orm/tree/b194ee0c5edabf223d646af7d11ed7cb62caf277).
The exact pinned sources take precedence where the website documents a newer
or broader behavior.

## Conclusion

Ticketry is completely overriding Seaography's generated **read** mechanism
for the WorkTracker cohort. `query_root/queries.rs`, `query_root/types.rs`, and
`work_management/read_queries/` recreate ordinary entity listing, filtering,
ordering, relationship loading, and model output projection. Generated entity
registration already supplies those capabilities, including relationship
fields, DataLoaders, related-entity filters, pagination, ordering, and field
guards. Those handwritten layers should become compatibility adapters only
where a caller-parity test proves that the generated contract cannot replace
them.

There is also a Ticketry composition prerequisite before those reads can be
deleted. `query_root::foundation_schema` constructs Seaography's `Builder`
with the disposable `rust-core.sqlite3` connection and supplies `state.db` as a
separate `ReadDatabase` only for custom WorkTracker resolvers. Seaography's
generated entity resolvers and DataLoaders use the builder/schema
`DatabaseConnection`; they do not choose a connection per entity. Registering
the WorkTracker cohort in the current composition would therefore query the
wrong database. Retire or isolate the disposable foundation probe and make the
WorkTracker database the builder's generated-entity connection before swapping
those resolvers to generated queries.

The answer for **writes** is narrower. Seaography already supplies static input
allowlists, runtime entity/field guards, row scoping, create-time model
injection/validation, post-mutation observation, transactions for batch create
and update, and SeaORM model lifecycle hooks. Those defaults should replace
custom resolvers when an operation is flat model CRUD and those mechanisms are
sufficient. However, Seaography rc.9 performs generated update and delete as
bulk statements. It does not provide the per-row pre-update/pre-delete hooks
needed for Ticketry's workflow, hierarchy, revision, locking, cascade, or
derived-repair invariants. Those operations still require a restricted,
model-shaped custom seam.

There is one further registration constraint: the public
`register_entity_mutations` API installs create-one, create-batch, update, and
delete together. `register_entity!(..., mutation: false)` disables all four;
there is no supported per-operation registration switch in rc.9. An entity
should therefore expose the generated mutation bundle only if all four public
operations are safe after guards, filters, input skips, model hooks, and
database constraints. Otherwise retain `mutation: false` for that entity and
author the smallest restricted model-shaped CRUD surface.

## What Seaography already provides

### Entity registration is the ordinary query path

`register_entity!` registers the entity object, relation fields, one-to-one and
one-to-many DataLoaders, and related-entity filtering. It includes generated
mutations by default and accepts `mutation: false` when writes must remain
custom. The generated mutation bundle consists of create-one, create-batch,
update, and delete. See the pinned
[`register_entity!` implementation](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/builder.rs#L667-L692)
and
[`register_entity_mutations`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/builder.rs#L202-L250).

Generated query fields already support filtering, ordering, offset/cursor
pagination, and filters through related entities. Generated relations are
DataLoader-backed, guarded, filtered, orderable, and paginated. See the
official [relational-query documentation](https://www.sea-ql.org/Seaography/docs/graphql-schema/relational-query/)
and the pinned
[`EntityObjectRelationBuilder`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/query/entity_object_relation.rs#L21-L217).

**Ticketry implication:** the fourteen ordinary resolvers in
`studio/src-tauri/src/query_root/queries.rs`, the mirrored structs in
`query_root/types.rs`, and their pass-through modules under
`work_management/read_queries/` are presumed deletable. Preserve one only when
an operation-level parity test demonstrates a necessary caller projection such
as a computed `key`, compact UUID formatting, flattened relation ID, decoded
JSON list, or an aggregate count. Even then, prefer changing the caller's
authored `.graphql` selection to generated fields and relations before keeping
a custom resolver.

### Static and runtime write allowlists do not require custom mutations

`BuilderContext.entity_input.insert_skips` and `update_skips` omit named
`{Entity}.{field}` entries from generated input objects. This is the built-in
mechanism for fields such as server-owned IDs, timestamps, counters, revisions,
rank, and protected relationship columns. See
[`EntityInputConfig`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/inputs/entity_input.rs#L8-L28)
and the
[`input_object` implementation](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/inputs/entity_input.rs#L61-L120).

For a field that must never exist anywhere in the generated GraphQL schema,
`#[seaography(ignore)]` removes it from output, filtering, ordering, and
mutation inputs. For caller-dependent policy, `field_guard` can allow or block
each submitted field for Create/Update and each requested field for Read. Use
static skips for the normal public allowlist and guards for contextual policy;
do not write a resolver merely to copy allowed arguments into an ActiveModel.
See Seaography's official
[schema-restriction guidance](https://www.sea-ql.org/Seaography/docs/access-control/schema-restrictions/)
and the pinned
[`LifecycleHooksInterface`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/builder_context/hooks.rs#L29-L75).

### Guards, row filters, and watchers are first-class hooks

`LifecycleHooksInterface` provides:

- `entity_guard` for operation-level Read/Create/Update/Delete policy;
- `field_guard` for field-level policy;
- `entity_filter` for mandatory row predicates on Read/Update/Delete;
- `before_active_model_save` to inspect, mutate, or reject generated creates;
- `entity_watch` after a generated mutation.

`MultiLifecycleHooks` combines multiple guards, watches, and row filters. A
row-ownership or installation-scope predicate belongs in `entity_filter`, not
in a replacement list/update/delete resolver. A public-read or operation
permission belongs in `entity_guard`. Cache invalidation or best-effort
notification after commit belongs in `entity_watch`; durable effects still
belong in the mutation transaction. The exact interface is in the pinned
[`hooks.rs`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/builder_context/hooks.rs#L29-L75).

There is an rc.9 bug to avoid: `MultiLifecycleHooks` does **not** forward
`before_active_model_save`, even though it forwards the other methods. If
Ticketry needs create-time ActiveModel injection, use one composite hook type
that explicitly dispatches it, or upstream/fix and pin the framework before
using `MultiLifecycleHooks`. See its complete pinned
[`MultiLifecycleHooks` implementation](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/builder_context/hooks.rs#L93-L160).

### Generated create invokes both Seaography and SeaORM lifecycle hooks

Create-one performs the entity guard, checks every submitted field, constructs
the ActiveModel, invokes `before_active_model_save`, calls
`ActiveModel::insert`, and finally invokes `entity_watch`. Create-batch does the
same per row inside one transaction. See the pinned
[`create-one resolver`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/mutation/entity_create_one_mutation.rs#L77-L129)
and
[`create-batch resolver`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/mutation/entity_create_batch_mutation.rs#L76-L142).

Because those paths call `ActiveModel::insert`, they also run SeaORM
`ActiveModelBehavior::before_save` and `after_save`. This is the appropriate
model seam for defaults, IDs, timestamps, synchronous/async validation, and
single-row derived fields that must apply to every ActiveModel write, not just
GraphQL. SeaORM documents the lifecycle methods and their abort-on-error
behavior in the pinned
[`ActiveModelBehavior` source](https://github.com/SeaQL/sea-orm/blob/b194ee0c5edabf223d646af7d11ed7cb62caf277/src/entity/active_model.rs#L1038-L1117).

Create hooks are not a transaction substitute. Generated create-one does not
wrap the hook's read/check and the eventual insert in an explicit transaction.
Cross-row allocation, locking, aggregate creation, and effects that must commit
atomically with the row remain a custom seam (or must be expressed by a database
constraint/default/trigger that makes the generated path safe).

### Generated update has a material hook gap

Generated update applies entity and submitted-field guards plus
`entity_filter`, then executes `Entity::update_many`. It does **not** invoke
Seaography `before_active_model_save` and does **not** invoke SeaORM
`before_save`. It manually calls SeaORM `after_save` for returned rows inside
its transaction, commits, and then calls `entity_watch`. See the pinned
[`entity update implementation`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/mutation/entity_update_mutation.rs#L86-L160).

Consequences:

- use `update_skips`/`field_guard` to prevent protected columns;
- use `entity_filter` for identity/ownership/revision predicates that can be
  expressed as a SQL condition;
- use generated update for flat patches whose invariants are already database
  constraints;
- do not rely on `ActiveModelBehavior::before_save` for generated updates;
- retain a restricted mutation when validation needs the old row, a lock,
  compare-and-set diagnostics, pre-update derived repair, or related writes.

`after_save` is too late to validate an update and should not perform durable
side effects that could be repeated per row unexpectedly. The rc.9 changelog
itself describes update `after_save` as a pending 2.0 bug fix, so its behavior
needs an explicit regression test before Ticketry relies on it. See the pinned
[`CHANGELOG`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/CHANGELOG.md#L8-L31).

### Generated delete has a material hook gap

Generated delete applies `entity_guard` and `entity_filter`, executes
`Entity::delete_many`, then invokes `entity_watch`. It does **not** call SeaORM
`before_delete` or `after_delete`. See the pinned
[`entity delete implementation`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/mutation/entity_delete_mutation.rs#L76-L107).

This is expected SeaORM behavior: ActiveModel lifecycle hooks apply to
ActiveModel `insert`, `update`, `save`, and `delete`, while Entity/bulk methods
skip them by design. See the official SeaORM Cookbook warning,
[“ActiveModelBehavior not being triggered”](https://www.sea-ql.org/sea-orm-cookbook/025-behaviors-not-being-triggered.html).

Generated delete is safe only when `entity_filter` plus database foreign keys,
cascades, and constraints fully express deletion policy. Protected-row checks,
reassignment, ordered teardown, durable delete events, and application-level
cascades require a restricted custom delete.

### Relations are generated for reads; mutation inputs remain flat

Generated relation fields should replace hand-written joins for ordinary
reads. Generated mutation inputs, however, iterate only entity columns and
`prepare_active_model` sets only those columns. Seaography does not generate a
nested relation-write input. See
[`EntityInputBuilder`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/inputs/entity_input.rs#L61-L120)
and
[`prepare_active_model`](https://github.com/SeaQL/seaography/blob/d530a9ff801e51cec4bf82bebb9e68a5af977bf2/src/mutation/entity_create_one_mutation.rs#L140-L173).

A relationship change represented by an allowed foreign-key column is still a
flat model update; a join table is still an entity and can use model CRUD if
its whole mutation bundle is safe. A transactional object-graph mutation is a
legitimate custom operation. SeaORM 2.0 offers
[Nested ActiveModel](https://www.sea-ql.org/SeaORM/docs/advanced-query/nested-active-model/)
for persistence, but Seaography rc.9 does not automatically expose it as
GraphQL input. Seaography's official
[custom mutation guide](https://www.sea-ql.org/Seaography/docs/custom-endpoints/custom-mutation/)
uses custom endpoints for such transactional multi-entity behavior.

## Ticketry replacement matrix

| Current Ticketry surface | Framework default to prefer | Disposition |
| --- | --- | --- |
| `query_root/queries.rs` entity list/detail resolvers | Generated entity query, filters, order, pagination | Replace by default. Keep only proven computed/compatibility projections. |
| `query_root/types.rs` mirrors of Workspace, Project, State, IssueType, Transition, LaunchBinding, Provider, AgentModel, ReasoningLevel | Generated entity model outputs and relation fields | Delete with corresponding resolvers; query actual entity/relation fields. |
| `work_management/read_queries/` pass-through queries | Generated query/filter/having/relation/DataLoader | Delete after operation parity. Preserve genuine aggregate/computed projections only. |
| Resolver-level read authorization or project scoping | `entity_guard`, `field_guard`, `entity_filter` | Move to one schema lifecycle-hook policy. |
| Resolver arguments copied directly into one entity | Generated insert/update input | Use generated CRUD if the entire entity mutation bundle is safe. |
| Server-owned IDs/timestamps/revisions/counters/ranks/protected FKs | `insert_skips`, `update_skips`, `field_guard`, DB defaults, create hooks | Configure centrally; do not recreate input DTO/resolver plumbing. |
| Single-row create defaults and validation | Seaography `before_active_model_save` and/or SeaORM `before_save` | Prefer hooks when no cross-row atomicity is needed. |
| Row ownership / installation scope / simple CAS predicate | `entity_filter` | Use generated update/delete only when a zero-row result is an adequate conflict response. |
| Post-commit cache invalidation / nondurable observation | `entity_watch` | Prefer hook; never use it as the durable event/outbox authority. |
| Generated relation reads and relation filters | Generated `RelatedEntity`, DataLoaders, and `having` | Replace handwritten joins/list resolvers. |
| Cross-row allocation, rank/reorder, graph validation, locking, revision-specific error, derived repair, durable effects | No sufficient rc.9 pre-update/pre-delete hook | Keep one restricted model-shaped mutation or the registered genuine operation. |
| Aggregate create/delete and nested relation writes | No generated nested mutation input | Keep a transactional custom seam; use SeaORM entities/Nested ActiveModel internally where useful. |

## Audit of the current custom mutations

The following classification is based on the current command implementations,
not merely mutation names.

### Clearly legitimate custom seams

- `create_project` creates a project plus default states, issue types,
  transitions, and launch bindings atomically.
- `delete_project` requires ordered aggregate teardown.
- state/issue-type/work-item reorder operations allocate and validate order.
- work-item create/update/archive/delete/reparent/transition/blocker operations
  enforce hierarchy, dependency, ranking, state revision, and effect rules.
- workflow transition and launch-binding changes use workflow revision
  compare-and-set and related-row validation.
- state and issue-type deletion perform protection, membership, reassignment,
  or cascade rules.
- attachment creation couples database metadata to validated file storage.
- onboarding acknowledgement is an already-recorded non-CRUD operation.
- run lifecycle, automation-attempt retry/dismissal, local profile/catalog
  changes, keybindings, and settings operations target non-entity stores or
  genuine behavior rather than ordinary Seaography model CRUD.

These should stay custom, but their GraphQL shape should remain model-shaped
where the operation is conceptually create/update/delete.

### Candidates only after invariants move below GraphQL

- `update_project`, `update_state`, and the ordinary-field subset of
  `update_issue_type` look like flat patches, but currently validate text/group,
  stamp `updated_at`, and in the IssueType case share a seam with workflow
  revision behavior. Generated update bypasses `before_save`; therefore these
  cannot safely switch merely by adding `ActiveModelBehavior` today. They become
  candidates only if database constraints/triggers express the invariants or
  Seaography gains a tested pre-update hook. Splitting start-state behavior into
  per-field RPC is not an acceptable workaround.
- `create_state` and `create_issue_type` look model-shaped but allocate order,
  choose defaults, check related rows/uniqueness, and need concurrency safety.
  Create hooks can remove some resolver boilerplate, but the check/allocation
  must be made transactional or database-enforced before using generated
  create-one.
- the disposable migration probe had been implemented as a validated upsert,
  but no product invariant required that shape. Recovery removed the
  `mutation: false` rewrite and authored resolver; it now exercises generated
  create/query behavior and preserves SeaORM codegen's registration unchanged.

## Recommended salvage sequence

1. Make the generated WorkTracker cohort type-correct and deterministic first;
   hooks cannot compensate for incorrect entity types or relations.
2. Remove the disposable probe from the product schema (or isolate it in a
   separate schema) and compose Seaography with the WorkTracker database as its
   generated-entity connection. Do not register WorkTracker entities while the
   builder still points at `rust-core.sqlite3`.
3. Register every generated WorkTracker entity with `mutation: false`. Replace
   custom reads, output mirrors, and pass-through repositories operation by
   operation. Add parity tests only for differences callers actually require.
4. Replace the default `BuilderContext` with a Ticketry-owned context containing
   one lifecycle policy. Centralize entity/field guards, row filters, and
   create-time injection there. Do not use rc.9 `MultiLifecycleHooks` without
   fixing its missing `before_active_model_save` forwarding.
5. Define and test the insert/update skip matrix for every entity. Treat the
   generated SDL as the allowlist contract and add drift tests proving protected
   fields are absent.
6. For each entity, evaluate **all four** generated mutations. Turn mutation
   registration on only when create-one, create-batch, update, and delete are
   all safe. Otherwise leave it off and keep the smallest restricted
   model-shaped mutations.
7. Put invariant behavior that must apply across GraphQL, MCP, and native
   callers in SeaORM model/application services or database constraints—not in
   GraphQL-only lifecycle hooks. Use Seaography hooks for transport policy and
   generated-resolver customization.
8. Add focused regression tests for the rc.9 boundaries: create hook order,
   update's missing `before_save`, delete's missing delete hooks,
   `entity_filter` scope, `entity_watch` timing, and `MultiLifecycleHooks` not
   forwarding create mutation.

## Documentation mismatch to remember

The current Seaography filters page describes `entity_filter` broadly, but the
pinned rc.9 interface explicitly says it applies to select/update/delete “but
not insert,” and neither generated create resolver calls it. Use
`entity_guard`, `field_guard`, `before_active_model_save`, and SeaORM
`before_save` for create policy. Trust the pinned source until an upgrade is
deliberately tested. The current upstream `main` still has the same create-only
`before_active_model_save`, bulk update/delete behavior, and
`MultiLifecycleHooks` omission as of this audit.
