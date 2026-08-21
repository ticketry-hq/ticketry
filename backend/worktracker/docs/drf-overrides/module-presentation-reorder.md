# Module presentation reorder DRF override

## Module presentation reorder

- DRF-native capability attempted: `UpdateModelMixin` with `ModulePresentationSerializer`.
- Exact missing behavior: the first module drag validates the complete visible order, creates ranked presentation rows for every active module, and moves one row between named neighbors in the same transaction.
- Why a frontend adapter over the generated SDK is insufficient: every client and non-HTTP writer must observe the same first-drag materialization and neighbor validation.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: transport validation cannot lock the project, compare the baseline with live rows, or allocate a fractional rank.
- Why `permission_classes` and `get_queryset` scoping are insufficient: row scoping does not coordinate creation and updates across all active modules.
- Why a database constraint/default is insufficient: the rank depends on the current neighboring presentation rows and the caller's first-drag baseline.
- Why an existing service function is insufficient: `reorder_module` owns the transaction, but a named action is still needed to validate the RPC-shaped request and serialize its result.
- Smallest custom seam: `ModulePresentationViewSet.reorder` validates `ModulePresentationReorderSerializer`, delegates once to `reorder_module`, and returns `ModulePresentationSerializer`.
- Service module / `transaction.atomic` used: `worktracker.services.module_reorder.reorder_module`, which locks the owning project and performs the materialization and move in one transaction.
- Protected fields excluded from the request schema: module identity comes from the URL; rank and tab visibility are absent. The body contains only neighbors and the optional first-drag baseline.
- Identity/scope binding (URL kwarg + queryset filter): `module_id` identifies a module issue; the service rejects missing, non-module, foreign-project neighbor, task-neighbor, and archived rows.
- Contract-drift and regression test: `npm run contract:check`; module presentation API, migration, first-drag, later-drag, archived-module, concurrency, and Studio acceptance tests cover the operation.
- Registry entry, if this is genuinely non-CRUD: `ModulePresentationViewSet.reorder`, registered in `worktracker.registry.DOMAIN_OPERATIONS`.
