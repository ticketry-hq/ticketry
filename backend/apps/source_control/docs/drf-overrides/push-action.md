# Source-control push DRF override record

## Commit and push one checkout

- DRF-native capability attempted: serializer-backed actions on `WorktreePushViewSet` and `ModulePushViewSet`.
- Exact missing behavior: the operation commits a Git checkout, pushes its current branch, and writes one server-owned ship record. The record is the receipt for the external operation, not a resource a client can create with `CreateModelMixin`.
- Why a frontend adapter over the generated SDK is insufficient: the sidecar must keep commit and push under one checkout lock and must save the receipt even when the push fails after the commit lands.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: serializers validate the checkout identifiers and expose the typed result, but they cannot run Git or coordinate its durable receipt.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies. The writer also verifies module and anchor-task ownership against the server's work item and worktree rows.
- Why a database constraint/default is insufficient: branch position and push success are current Git and remote facts. Database constraints protect only the settled receipt.
- Why an existing service function is insufficient: `apps.source_control.stacked_action` remains the service and owns the full operation. The ViewSet only validates and serializes it.
- Smallest custom seam: `WorktreePushViewSet.commit_push`, `ModulePushViewSet.commit_push`, and their read-only preview actions.
- Service module / `transaction.atomic` used: `apps.source_control.stacked_action` serializes the Git steps. `apps.source_control.ship_records` uses a short transaction after Git settles.
- Protected fields excluded from the request schema: action identifiers, record owners, branch, remote, force options, hook bypasses, commands, output, credentials, and filesystem paths are not accepted.
- Identity/scope binding (URL kwarg + queryset filter): the server resolves the checkout, then verifies its module and anchor task before writing the record.
- Contract-drift and regression test: `apps/source_control/tests/test_push_api.py` and `test_ship_record_actions.py` use real repositories and a local bare remote; `npm run contract:check` seals the schema.
- Registry entry, if this is genuinely non-CRUD: the commit-push and push-preview routes are declared in `worktracker.registry.HOST_ROUTES`.
