# Source-control commit DRF override record

## Commit a task worktree's changes

- DRF-native capability attempted: a serializer-backed create action on `WorktreeCommitViewSet`.
- Exact missing behavior: the request commits a git working tree rather than creating an ORM row, so there is no model, queryset, or instance for `CreateModelMixin` to build; the response is an ordered list of typed step outcomes, and a clean tree is an explicit `nothing_to_commit` skip on `200` rather than a created resource or an error.
- Why a frontend adapter over the generated SDK is insufficient: only the sidecar can reset an index, stage a working tree, spawn a headless generator CLI, and run `git commit` with the repository's hooks.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the request serializer does validate the whole input — three context identifiers and nothing else — but resetting the index, staging, generating a subject, and running hooks is application behavior with no serializer expression.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies, and the scope that matters is not a queryset but the recorded worktree path for the task; `apps.source_control.checkouts.checkout` resolves it and refuses anything that is no longer a git checkout.
- Why a database constraint/default is insufficient: what may be committed, and whether the repository's hooks accept it, are current git facts held on disk.
- Why an existing service function is insufficient: the application operation `apps.source_control.commit.commit_worktree_changes` is retained and owns all of the behavior; the custom seam only invokes and serializes it.
- Smallest custom seam: `WorktreeCommitViewSet.commit`.
- Service module / `transaction.atomic` used: `apps.source_control.actions.commit` coordinates git through `apps.source_control.clients.git_cli` and serializes writes per checkout through `apps.source_control.actions.checkout_lock`. No transaction is used or wanted: the durable state changed here is the git repository, and holding a database transaction across a hook that may run for minutes would be worse than useless.
- Protected fields excluded from the request schema: no path list, no commit message, no `--no-verify` equivalent, and no filesystem path are accepted. The commit takes the whole change set, the subject is generated, and hooks always run — none of which a client may override. Branch, sha, subject, message source, and counts are read-only response fields.
- Identity/scope binding (URL kwarg + queryset filter): `task_id` is required in the body, with optional `parent_id` and `module_id`; the worktrees service derives the top-level worktree identity from that context, exactly as the review reads do.
- Contract-drift and regression test: `apps/source_control/tests/test_commit_api.py`, `test_commit_message_generation.py`, and `test_commit_serialization.py` cover the whole change set, index reset, the no-change skip, hook failure, generator preference and fallback, subject sanitization, and per-checkout serialization against real temporary repositories; `npm run contract:check` seals the schema.
- Registry entry, if this is genuinely non-CRUD: `POST /api/worktrees/changes/commit` in `worktracker.registry.HOST_ROUTES`.
