# Source-control commit DRF override record

## Commit a task worktree's changes

- DRF-native capability attempted: a serializer-backed create action on `WorktreeCommitViewSet`.
- Exact missing behavior: the request commits a git working tree, then writes a server-owned `ShipRecord` as the receipt for that action. The record is a side effect rather than a client-created resource, so `CreateModelMixin` cannot express the operation. The response contains ordered typed step outcomes and the immutable record.
- Why a frontend adapter over the generated SDK is insufficient: only the sidecar can reset an index, stage a working tree, spawn a headless generator CLI, and run `git commit` with the repository's hooks.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the request serializer does validate the whole input — three context identifiers and nothing else — but resetting the index, staging, generating a subject, and running hooks is application behavior with no serializer expression.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies, and the scope that matters is not a queryset but the recorded worktree path for the task; `apps.source_control.checkout` resolves it and refuses anything that is no longer a git checkout.
- Why a database constraint/default is insufficient: what may be committed and whether the repository's hooks accept it are current git facts held on disk. Constraints protect the resulting ship record after those facts settle.
- Why an existing service function is insufficient: the application operation `apps.source_control.commit.commit_worktree_changes` is retained and owns all of the behavior; the custom seam only invokes and serializes it.
- Smallest custom seam: `WorktreeCommitViewSet.commit`.
- Service module / `transaction.atomic` used: `apps.source_control.commit` coordinates git and serializes writes per checkout. `apps.source_control.ship_records` opens one short transaction only after Git settles. It never holds a database transaction across hooks.
- Protected fields excluded from the request schema: no action identifier, owner, path list, commit message, hook bypass, or filesystem path is accepted. The server owns the action identifier, resolves module and anchor-task ownership, and returns the record through the read-only `ShipRecordSerializer`.
- Identity/scope binding (URL kwarg + queryset filter): `task_id` identifies the requested task. The ship writer verifies the requested task, resolved worktree anchor, worktree index, and module relationship against server rows before it creates the record.
- Contract-drift and regression test: `apps/source_control/tests/test_commit_api.py`, `test_commit_message_generation.py`, `test_commit_serialization.py`, and `test_ship_record_actions.py` cover the Git operation and durable receipt against real temporary repositories. `npm run contract:check` seals the schema.
- Registry entry, if this is genuinely non-CRUD: `POST /api/worktrees/changes/commit` in `worktracker.registry.HOST_ROUTES`.
