---
name: seaography-graphql
description: Build or migrate Ticketry's database-backed Rust GraphQL queries and mutations using Seaography-generated contracts, SeaORM entities, type maps, guards, filters, and lifecycle hooks. Use whenever adding, changing, reviewing, or removing a WorkTracker GraphQL query/mutation or custom resolver.
---

# Seaography-first GraphQL

Use Seaography as the default API and make custom code prove why it exists.
The desired path is:

```text
database migration -> SeaORM entity -> Seaography registration
                   -> caller-owned .graphql operation -> generated client types
```

Do not begin with a resolver, DTO, repository, or RPC name.

## Before changing code

1. Read the database-backed GraphQL rules in `../../../AGENTS.md` and
   `../../../CLAUDE.md`.
2. Confirm the pinned Seaography and SeaORM versions in
   `../../../studio/src-tauri/Cargo.toml`.
3. Read [the pinned hook matrix](references/seaography-rc9-hooks.md). If the
   dependency version changed, re-audit the upstream source before relying on
   the matrix.
4. Identify the migration/table, SeaORM entity, entity registration, caller's
   `.graphql` operation, and acceptance test affected by the change.
5. Confirm that Seaography's builder uses the database that owns the entity.
   Generated resolvers and DataLoaders use the builder connection; a second
   connection placed in GraphQL context does not redirect them.

## Build reads from the generated graph

For an ordinary list, detail, filter, ordering, pagination, or relation read:

1. Register the SeaORM entity with Seaography. Keep `mutation: false` while
   writes are still unaudited.
2. Write a caller-specific operation in the owning frontend feature's
   `operations/*.graphql` file.
3. Select generated entity columns and generated relation fields. Use generated
   `filters`, `having`, ordering, cursor/offset pagination, and DataLoader-backed
   relations before writing query code.
4. Use GraphQL aliases and a small frontend adapter when the caller wants a
   different name or presentation shape.
5. Use `BuilderContext.types.column_options` when one database column needs a
   reversible GraphQL codec, such as UUID normalization or JSON-to-list
   conversion. Keep this configuration centralized in
   `../../../studio/src-tauri/src/query_root/context.rs`.

Do not add a mirrored Rust output struct, pass-through read repository, or
custom resolver merely to rename fields, flatten relation IDs, or reshape data
for one screen. Fetch the model graph and adapt at the caller.

A custom query is justified only when the result cannot be represented by
generated entity columns/relations, such as a database aggregate or computed
projection that the generated graph cannot expose. First record the exact
missing capability and add a parity test that keeps the exception narrow.

## Audit all four generated writes together

Seaography `2.0.0-rc.9` natively installs create-one, create-batch, update, and
delete together. Ticketry's
`graphql_foundation::generated_mutations::register_generated_mutations` helper
assembles the same public Seaography builders selectively. Register the entity
with `mutation: false`, then call the helper once with the audited selection.
Do not copy or wrap generated resolvers.

Before selecting any write, fill out this table for the entity:

| Operation | Public fields | Identity/scope | Invariants | Safe framework seam |
| --- | --- | --- | --- | --- |
| Create one | | | | |
| Create batch | | | | |
| Update | | | | |
| Delete | | | | |

Each row is an independent publication decision. An unsafe delete no longer
blocks a safe create-one, but it remains private. Generated update and delete
still accept optional filters and can affect multiple rows, so do not select
them when Ticketry requires a non-null concrete identity.

```rust
seaography::register_entity!(builder, model, mutation: false);
register_generated_mutations::<model::Entity, model::ActiveModel>(
    &mut builder,
    GeneratedMutations {
        create_one: true,
        create_batch: false,
        update: false,
        delete: false,
    },
);
```

The `mutation: false` registration and helper call form one generated contract.
The completed four-row audit and an SDL selection test are the required written
evidence; do not add a second registration or call the helper twice for one
entity.

For generated writes, configure these layers before authoring code:

- `insert_skips` and `update_skips` remove server-owned or protected fields
  from generated inputs.
- `#[seaography(ignore)]` removes a field everywhere when it must not be part of
  the public graph.
- `entity_guard` controls operation-level access.
- `field_guard` controls submitted write fields and requested read fields.
- `entity_filter` adds mandatory row scope to reads, updates, and deletes.
- database defaults and constraints enforce facts the database can express.
- Seaography/SeaORM create hooks supply defaults and single-row validation.

The generated SDL is the public allowlist. Add a drift test proving protected
fields are absent; do not rely on clients voluntarily omitting them.

## Put behavior in the correct layer

Use the lowest layer that owns the rule:

| Need | Put it here |
| --- | --- |
| Caller-specific field names or shape | `.graphql` aliases and frontend adapter |
| One-column input/output conversion | Seaography `ColumnOptions` |
| GraphQL operation/field authorization | `entity_guard` / `field_guard` |
| Mandatory row ownership or scope | `entity_filter` |
| Create-only ActiveModel injection | `before_active_model_save` |
| Invariant for every ActiveModel writer | SeaORM `ActiveModelBehavior` |
| Uniqueness, referential integrity, simple validation | database constraint/default |
| Cross-row locking, revision CAS, hierarchy/graph repair, atomic related writes | focused domain service inside a transaction |
| Best-effort post-mutation observation | `entity_watch` |
| Durable event or side effect | mutation transaction/outbox, never `entity_watch` |

Seaography hooks customize the GraphQL transport. They are not a substitute for
domain rules that must also hold for MCP, native, background, or test writers.

## Keep necessary overrides model-shaped

For each generated write that is not safe:

1. Leave that operation unselected in the Ticketry helper.
2. Expose the smallest restricted `create<Model>`, `update<Model>`, and/or
   `delete<Model>` seam.
3. Bind a concrete non-null identity for update/delete.
4. Allowlist only caller-writable fields and preserve
   `omitted | null | value` patch semantics.
5. Return the authoritative SeaORM entity model after create/update.
6. Delegate invariants to focused internal domain modules; keep the GraphQL
   resolver as thin context/input/result plumbing.

Do not split model fields or relationships into separate public RPCs. For
example, parent, blockers, classification, archive, and state remain fields of
the restricted WorkItem update contract even though internal modules implement
their rules.

A named domain operation is allowed only when the behavior is not model CRUD.
It must be in the route/operation registry with its reason. The current allowed
exceptions are work-item reorder, state reorder, issue-type reorder,
remove-state-from-workflow, and onboarding acknowledgement.

Before adding any override, copy and complete
[the override record](references/override-record.md). Do not add mirrored DTOs,
replacement CRUD, `mutation: false`, or generated-file patches without that
evidence.

## Use SeaORM inside custom seams

Custom does not mean bypassing the ORM.

- Query with SeaORM `Entity`, filters, relations, and loaders.
- Write with `ActiveModel` when lifecycle behavior is required.
- Use `DatabaseTransaction` for locking, compare-and-set, related writes,
  cascades, derived repair, and durable effects.
- Use `update_many`/`delete_many` only deliberately; they bypass ActiveModel
  pre-save/pre-delete hooks.
- Do not create a DAO/repository that merely mirrors SeaORM.
- Do not use `rusqlite`, SQLx, or raw SQL for ordinary model CRUD. Raw SQL is a
  last resort for a documented database primitive SeaORM cannot express, and
  requires a focused regression test.

## Verification

Test the boundary that made the design safe:

- generated SDL/operation drift and protected-field absence;
- selected-operation drift: only the audited create-one/create-batch/update/
  delete fields and their required input/output types are present;
- real GraphQL query/mutation behavior, including relations and codecs;
- unauthorized and out-of-scope rows for guards/filters;
- create/update/delete hook behavior at the pinned framework version;
- transaction rollback for custom invariant-heavy writes;
- authoritative client cache/list convergence;
- a Studio acceptance case for every user-visible behavior change.

Run the smallest focused tests first, then at minimum:

```bash
cargo +1.95.0 check --locked --manifest-path studio/src-tauri/Cargo.toml
npm run graphql:drift --workspace @worktracker/studio
npm run typecheck --workspace @worktracker/studio
npm run test:overhaul --workspace @worktracker/studio
```

When handing off, state which operations now use generated Seaography, which
remain custom, and the exact invariant blocking each remaining override.
