# Seaography 2.0.0-rc.9 hook matrix

This repository pins Seaography `2.0.0-rc.9` and SeaORM `2.0.1`. These facts are
version-specific. Re-audit upstream source when either dependency changes.

| Path | Before execution | Persistence behavior | After execution |
| --- | --- | --- | --- |
| Generated read | `entity_guard(Read)`, `field_guard(Read)`, `entity_filter(Read)` | Generated query, filters, relations, pagination and DataLoaders | No general after-query hook |
| Generated create-one | `entity_guard(Create)`, `field_guard(Create)`, `before_active_model_save`, SeaORM `before_save` | `ActiveModel::insert`; no explicit surrounding transaction | SeaORM `after_save`, then `entity_watch` |
| Generated create-batch | Same create hooks per row | Inserts run inside one transaction | SeaORM `after_save` per row, commit, then `entity_watch` |
| Generated update | `entity_guard(Update)`, `field_guard(Update)`, `entity_filter(Update)` | `Entity::update_many` in a transaction | Manually runs SeaORM `after_save` for returned rows, commits, then `entity_watch` |
| Generated delete | `entity_guard(Delete)`, `entity_filter(Delete)` | `Entity::delete_many` | `entity_watch` |

## Material gaps

- `before_active_model_save` is a generated-create hook only.
- Generated update does **not** run `before_active_model_save` or SeaORM
  `before_save`.
- Generated delete does **not** run SeaORM `before_delete` or `after_delete`.
- `entity_filter` applies to read/update/delete, not create.
- `entity_watch` is post-mutation observation. Do not put validation or durable
  effects there.
- rc.9 `MultiLifecycleHooks` does not forward
  `before_active_model_save`. Use one Ticketry-owned composite hook that
  dispatches it explicitly, or fix/pin the framework before composing hooks.
- Mutation registration is all-or-nothing per entity. There is no supported
  create/update/delete registration switch in rc.9.
- Generated mutation inputs are flat columns. Relation reads are generated;
  nested/aggregate relation writes are not.

## Consequences

Generated create is suitable for defaults, IDs, timestamps, and single-row
validation when no cross-row atomicity is required. Generated update/delete are
suitable only when skips, guards, row filters, and database constraints fully
express the invariant. Old-row validation, locking, revision diagnostics,
ordered teardown, cross-row repair, and transactional relation changes require
a restricted custom seam.

## Primary sources

- [Seaography lifecycle hooks](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder_context/hooks.rs)
- [Generated create-one](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_create_one_mutation.rs)
- [Generated create-batch](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_create_batch_mutation.rs)
- [Generated update](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_update_mutation.rs)
- [Generated delete](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/mutation/entity_delete_mutation.rs)
- [Generated mutation registration](https://github.com/SeaQL/seaography/blob/2.0.0-rc.9/src/builder.rs)
- [SeaORM ActiveModel lifecycle](https://github.com/SeaQL/sea-orm/blob/2.0.1/src/entity/active_model.rs)
- [SeaORM bulk-operation hook warning](https://www.sea-ql.org/sea-orm-cookbook/025-behaviors-not-being-triggered.html)

The detailed Ticketry audit is in
`../../../../rust-migration/seaography-hooks-audit.md`.
