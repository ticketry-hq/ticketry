# Graph-run DRF override records

## Retrieve dependency graph

- DRF-native capability attempted: a serializer-backed detail action on the graph-run ViewSet.
- Exact missing behavior: the representation is a factual, recursively derived work-item subtree that exists before a persisted graph-run header does.
- Why a frontend adapter over the generated SDK is insufficient: archived-branch filtering, dependency scoping, and workflow state are backend-owned facts.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the response serializer enforces shape but cannot derive the subtree.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; the graph is not a single model queryset.
- Why a database constraint/default is insufficient: the projection spans hierarchy, blockers, and workflow state without writing data.
- Why an existing service function is insufficient: `get_dependency_graph` is used directly; only the DRF action remains custom.
- Smallest custom seam: one GET detail action that calls the service once and serializes its result.
- Service module / `transaction.atomic` used: `apps.execution.api.get_dependency_graph`; read consistency remains in the execution driver.
- Protected fields excluded from the request schema: GET has no request body.
- Identity/scope binding (URL kwarg + queryset filter): `issue_id` is bound from the URL; live-root resolution and archived filtering are service-owned.
- Contract-drift and regression test: execution API graph projection tests plus `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: `MODEL_ROUTES` registers GET on the graph-run singleton.

## Create or advance graph run

- DRF-native capability attempted: a serializer-backed create detail action on the graph-run ViewSet.
- Exact missing behavior: one request atomically arms or advances a campaign and may launch multiple eligible direct children.
- Why a frontend adapter over the generated SDK is insufficient: campaign locking, eligibility, launch effects, and durable launch facts must be enforced server-side.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: DRF validates optional launch context; execution-mode policy and campaign invariants apply to every service caller.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; work-item eligibility and campaign scope are domain rules.
- Why a database constraint/default is insufficient: constraints guard duplicate rows but cannot coordinate launching, retry behavior, or compensation.
- Why an existing service function is insufficient: `create_execute_graph` is used directly; only the DRF action remains custom.
- Smallest custom seam: one POST detail action with a named request serializer and one service call.
- Service module / `transaction.atomic` used: `apps.execution.api.create_execute_graph`; per-root serialization and transactions remain in `apps.execution.driver`.
- Protected fields excluded from the request schema: root id, project/module identity, launch facts, and result ids are server-owned; only `agent` and `mode` are accepted.
- Identity/scope binding (URL kwarg + queryset filter): root identity comes only from `issue_id`; service lookup validates the live work item and configured subtree-run policy.
- Contract-drift and regression test: execution API scheduling/mode/error tests, default-auth test, and `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: `MODEL_ROUTES` registers POST on the graph-run singleton.

## Reset graph run

- DRF-native capability attempted: a serializer-backed delete detail action on the graph-run ViewSet.
- Exact missing behavior: reset returns the cleared child ids in a `200` body while serializing against concurrent launch/advance work.
- Why a frontend adapter over the generated SDK is insufficient: only the backend can lock the root and remove durable campaign state safely.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: DELETE has no input fields; the response serializer only enforces output shape.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; graph existence and locked cleanup are service-owned.
- Why a database constraint/default is insufficient: coordinated deletion and its returned cleared-id projection require domain behavior.
- Why an existing service function is insufficient: `reset_execute_graph` is used directly; only the DRF action remains custom.
- Smallest custom seam: one DELETE detail action that calls the service once and serializes the established response body.
- Service module / `transaction.atomic` used: `apps.execution.api.reset_execute_graph`; per-root serialization and deletion remain in `apps.execution.driver`.
- Protected fields excluded from the request schema: DELETE explicitly declares no request body.
- Identity/scope binding (URL kwarg + queryset filter): root identity comes only from `issue_id`; service lookup refuses missing campaigns.
- Contract-drift and regression test: reset success/not-found/concurrency tests plus `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: `MODEL_ROUTES` registers DELETE on the graph-run singleton.
