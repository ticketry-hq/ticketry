# Worktree operation DRF override records

## Live worktree status

- DRF-native capability attempted: a serializer-backed read action on `WorktreeViewSet`.
- Exact missing behavior: status combines a task context, selected local profile, persisted worktree index, and live git state; absence is returned as `kind=none` or `kind=no_repo`, never 404.
- Why a frontend adapter over the generated SDK is insufficient: live git and host-profile state exist only in the sidecar.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the query serializer validates input, but profile resolution and git inspection are application behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies, but the projection is not one database queryset.
- Why a database constraint/default is insufficient: cleanliness, divergence, and conflicts are current git facts.
- Why an existing service function is insufficient: the existing application operation is retained; the custom seam only invokes and serializes it.
- Smallest custom seam: `WorktreeViewSet.status`.
- Service module / `transaction.atomic` used: `apps.worktrees.api.get_worktree` delegates persistence and git inspection to `apps.worktrees.dao` and `apps.worktrees.service`; this read needs no transaction.
- Protected fields excluded from the request schema: only `task_id`, `parent_id`, and `module_id` are accepted; repository paths and branch state are read-only response fields.
- Identity/scope binding (URL kwarg + queryset filter): `task_id` is required by the query serializer; the service derives the top-level worktree identity from task, parent, and module context.
- Contract-drift and regression test: `apps/worktrees/tests/test_api.py` covers missing identity, authentication, absent repositories, live status, and shared parent status; `npm run contract:check` seals the schema.
- Registry entry, if this is genuinely non-CRUD: `GET /api/worktrees` in `worktracker.registry.HOST_ROUTES`.

## Idempotent worktree creation

- DRF-native capability attempted: a serializer-backed create action on `WorktreeViewSet`.
- Exact missing behavior: creation is an idempotent host git operation that preserves the established `200` status and returns live status rather than creating an ordinary ORM resource through `CreateModelMixin`.
- Why a frontend adapter over the generated SDK is insufficient: only the sidecar can create a git worktree and persist its index safely.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: DRF validates the context fields; repository discovery, naming, git creation, and idempotency belong to the service.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; profile module links establish the host repository scope.
- Why a database constraint/default is insufficient: the operation coordinates git state with the worktree index and must reconcile existing worktrees.
- Why an existing service function is insufficient: the existing application and service functions are retained; the action is the minimal transport adapter.
- Smallest custom seam: `WorktreeViewSet.create_worktree`.
- Service module / `transaction.atomic` used: `apps.worktrees.api.create_worktree` delegates to `apps.worktrees.service.create`, whose DAO preserves the unique task identity; git compensation remains service-owned.
- Protected fields excluded from the request schema: branch, base branch, filesystem path, status, timestamps, and persisted worktree identity are never writable.
- Identity/scope binding (URL kwarg + queryset filter): `task_id` comes only from `/worktrees/{task_id}/create`; module and parent context are serializer validated.
- Contract-drift and regression test: `apps/worktrees/tests/test_api.py` covers creation, idempotency, missing folders, and authentication; the Studio client uses the generated operation.
- Registry entry, if this is genuinely non-CRUD: `POST /api/worktrees/{task_id}/create` in `worktracker.registry.HOST_ROUTES`.

## Worktree discard

- DRF-native capability attempted: a serializer-backed discard action on `WorktreeViewSet`.
- Exact missing behavior: discard removes an indexed git worktree without integration and returns an idempotent `{removed, reason}` result on the established POST route.
- Why a frontend adapter over the generated SDK is insufficient: destructive git cleanup and index reconciliation must occur in the sidecar.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: serializers validate context and output; removal and cleanup are service behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; the target is derived from task hierarchy rather than exposed as a writable database row.
- Why a database constraint/default is insufficient: git worktree removal is an external filesystem effect.
- Why an existing service function is insufficient: the existing discard service is retained; the custom action only binds and serializes it.
- Smallest custom seam: `WorktreeViewSet.discard`.
- Service module / `transaction.atomic` used: `apps.worktrees.api.discard_worktree` delegates to `apps.worktrees.service.discard`; filesystem cleanup and row deletion remain service-owned.
- Protected fields excluded from the request schema: only parent and module context are accepted; `task_id` is URL-owned and all git metadata is server-owned.
- Identity/scope binding (URL kwarg + queryset filter): `task_id` comes only from `/worktrees/{task_id}/discard`; the service derives the top-level task identity.
- Contract-drift and regression test: `apps/worktrees/tests/test_api.py` covers successful and missing discard plus authentication; the Studio client uses the generated operation.
- Registry entry, if this is genuinely non-CRUD: `POST /api/worktrees/{task_id}/discard` in `worktracker.registry.HOST_ROUTES`.
