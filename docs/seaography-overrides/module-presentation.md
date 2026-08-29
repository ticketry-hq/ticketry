## ModulePresentation writes

- Generated capability attempted: generated reads plus create-one, create-batch, update, and delete.
- Exact missing behavior: first drag must lock one project and seed every active module atomically. Reorder must validate concrete neighbors and revision state. Visibility must update one concrete module without changing rank.
- Why `.graphql` selection/alias/adapter is insufficient: client operations cannot add database locking, identity binding, or cross-row validation.
- Why `ColumnOptions`, skips, guards, or `entity_filter` are insufficient: generated update and delete accept optional filters and can affect several rows. Generated create cannot seed the full active module set under the project lock.
- Why a database constraint/default and SeaORM lifecycle hooks are insufficient: constraints enforce uniqueness and cascade, but cannot validate neighbor order or seed ranks across rows.
- Create-one safety: private. A caller could create a partial manual-order set.
- Create-batch safety: private. The generated operation does not lock the project or derive the complete active set.
- Update safety: private. Rank and visibility need concrete module identity and separate field allowlists.
- Delete safety: private. Deleting a presentation row changes the project back to automatic ordering without the required project lock or intent.
- Smallest custom seam: `update_module_presentation(module_id, tab_hidden)` is the restricted model-shaped update. `reorder_module_presentation(module_id, before_id, after_id, initial_order_ids)` is the recorded reorder operation.
- SeaORM transaction/domain module used: the visibility command updates or creates one SeaORM ActiveModel in a transaction. The reorder command locks Project, seeds or updates ModulePresentation ActiveModels, and records the WorkItem revision in the same transaction.
- Protected fields excluded: `module_id`, `rank`, and `tab_hidden` are absent from public generated mutation inputs because all generated writes remain private.
- Identity/scope binding: both writes bind one non-null module identity. Reorder verifies the module, project, active baseline, and concrete neighbor identities inside the transaction.
- Drift/regression test: the SDL test requires generated ModulePresentation reads, rejects generated writes, and checks the restricted visibility and reorder allowlists. Command tests cover first drag, later drag, stale neighbors, insertion, archived exclusion, and rank/visibility preservation.
- Registry entry, if this is genuinely non-CRUD: `reorder_module_presentation` is registered because first drag seeds a project-wide rank set before moving one row. Visibility remains model-shaped CRUD.
