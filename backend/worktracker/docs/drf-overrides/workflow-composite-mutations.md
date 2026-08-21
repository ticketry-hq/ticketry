# Workflow composite mutation DRF overrides

## Transition delete

- DRF-native capability attempted: `DestroyModelMixin` on the transition ViewSet.
- Exact missing behavior: DRF destroy does not validate a JSON request body carrying the mandatory workflow revision, and drf-spectacular assumes every PATCH body is optional although this operation requires both mutable fields.
- Why a frontend adapter over the generated SDK is insufficient: the revision is a server-enforced optimistic-concurrency guard.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: `DestroyModelMixin` never instantiates a request serializer.
- Why `permission_classes` and `get_queryset` scoping are insufficient: they bind access and identity but do not validate the revision token.
- Why a database constraint/default is insufficient: the revision must be compared while the issue type is locked in the mutation transaction.
- Why an existing service function is insufficient: `remove_transition` owns the atomic comparison and pruning, but the HTTP body still needs transport validation.
- Smallest custom seam: update validates the two-field `IssueTypeTransitionUpdateSerializer`, delegates through `perform_update`, and serializes the full row; destroy validates `WorkflowRevisionSerializer`, delegates once to `remove_transition`, and returns 204. A focused AutoSchema subclass renders the required PATCH serializer and explicit DELETE serializer without changing runtime behavior.
- Service module / `transaction.atomic` used: `worktracker.services.scoped_workflows.remove_transition`.
- Protected fields excluded from the request schema: the request exposes only `workflow_revision`.
- Identity/scope binding (URL kwarg + queryset filter): `type_id`, `from_state_id`, and `to_state_id`; the transition queryset is filtered by issue type and destination, with the source as DRF's lookup field.
- Contract-drift and regression test: `npm run contract:check`; unchanged coverage in `test_transition_crud.py` verifies stale revision rejection, pruning, and the 204 result.
- Registry entry, if this is genuinely non-CRUD: not applicable; this remains model delete with optimistic concurrency.

## Launch-binding upsert and delete

- DRF-native capability attempted: `UpdateModelMixin` and `DestroyModelMixin` on the launch-binding ViewSet.
- Exact missing behavior: PUT is an established composite-key upsert that may return 201, while DELETE validates a JSON revision body and intentionally succeeds when no row exists.
- Why a frontend adapter over the generated SDK is insufficient: changing PUT to create-or-update client orchestration would break atomic revision comparison and race safety.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: stock update requires an existing object and stock destroy never validates a request body.
- Why `permission_classes` and `get_queryset` scoping are insufficient: they cannot implement atomic upsert or revision comparison.
- Why a database constraint/default is insufficient: the issue type revision and composite binding row must be locked and mutated together.
- Why an existing service function is insufficient: the services own the atomic behavior, but the ViewSet must select the write serializer and preserve the established 200/201/204 transport contract.
- Smallest custom seam: custom `update` and `destroy` methods on the launch-binding ViewSet; both validate named serializers, delegate once to the existing services, and serialize the service result.
- Service module / `transaction.atomic` used: `worktracker.services.launch_bindings.upsert_launch_binding` and `delete_launch_binding`.
- Protected fields excluded from the request schema: `id`, `issue_type`, `state`, `created_at`, and `updated_at` remain read-only; delete exposes only `workflow_revision`.
- Identity/scope binding (URL kwarg + queryset filter): the detail URL binds `type_id` and `state_id`; the service validates that the state belongs to the issue type's project under the locked revision.
- Contract-drift and regression test: `npm run contract:check`; unchanged coverage in `test_launch_binding_catalog_crud.py` verifies create/update status, revision rejection, catalog validation, deletion, and persistence.
- Registry entry, if this is genuinely non-CRUD: not applicable; this is model upsert/delete at an established composite key.
