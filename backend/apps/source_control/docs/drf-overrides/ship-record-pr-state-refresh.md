## Ship record / refresh pull request state

- DRF-native capability attempted: a `GenericViewSet` detail action over the read-only `ShipRecordSerializer`, with URL identity supplied by the scoped queryset.
- Exact missing behavior: refreshing invokes GitHub once and changes only two server-owned fields after the external result succeeds. Model CRUD cannot represent that bounded external operation.
- Why a frontend adapter over the generated SDK is insufficient: Studio cannot call GitHub or write immutable ship records. The backend owns credentials, bounds, normalization, and persistence.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: no client field is writable. The stored PR URL is the lookup input and the response fields stay read-only.
- Why `permission_classes` and `get_queryset` scoping are insufficient: the scoped queryset binds project, module, and record identity, but it cannot perform or normalize the GitHub lookup.
- Why a database constraint/default is insufficient: GitHub's current PR state is external data. Database constraints continue to limit the stored state enum.
- Why an existing service function is insufficient: the existing pull-request service creates PRs. It does not read the state of a stored PR URL.
- Smallest custom seam: `ModuleShipRecordViewSet.refresh_pr_state` validates an empty request, resolves one scoped record, calls one service, and serializes the updated model.
- Service module / `transaction.atomic` used: `apps.source_control.records.pull_request_state` owns the one bounded `gh` call. `apps.source_control.records.ship_record_refresh` opens a short transaction only after that call succeeds and updates `pr_state` plus `pr_refreshed_at`.
- Protected fields excluded from the request schema: every ship-record field, command argument, environment value, credential, and provider output is excluded. The request serializer has no fields.
- Identity/scope binding (URL kwarg + queryset filter): `record_id` is resolved through `project_id` plus `module_id` filters in `ModuleShipRecordViewSet.get_queryset`.
- Contract-drift and regression test: `apps/source_control/tests/test_ship_record_refresh_api.py`, the OpenAPI contract assertions, both generated SDK smoke tests, and Studio overhaul case 183 cover the action. `npm run contract:check` seals the generated files.
- Registry entry, if this is genuinely non-CRUD: `worktracker.registry.DOMAIN_OPERATIONS` names the one-record GitHub refresh and its reason.
