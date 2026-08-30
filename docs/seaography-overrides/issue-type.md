## IssueType update and reorder

- Generated capability attempted: generated create-one, create-batch, update, and delete, plus Seaolim's restricted one-row and write-set mutations.
- Exact missing behavior: update must bind one identity and combine ordinary fields with a revision-guarded start-state change, project membership checks, and transactional workflow pruning. Reorder must replace one project's complete Issue Type order atomically.
- Why `.graphql` selection/alias/adapter is insufficient: a caller document cannot bind the generated update filter, claim a workflow revision, validate state ownership, prune workflow rows, or make a complete reorder atomic.
- Why `ColumnOptions`, skips, guards, or `entity_filter` are insufficient: generated update still accepts an optional filter and can affect several rows. Hooks and filters do not expose the old row or a complete ordered set for revision and membership checks.
- Why a database constraint/default and SeaORM lifecycle hooks are insufficient: the database enforces unique names, but it cannot compare a caller revision, validate full project membership, prune unreachable transitions and bindings, or assign a contiguous order from a supplied identity list.
- Create-one safety: generated and public. The Issue Type create view owns its audited input and lifecycle defaults.
- Create-batch safety: private. Ticketry has no batch create contract or caller that owns a batch identity set.
- Update safety: generated update remains private. `update_issue_type` is the restricted one-row update.
- Delete safety: private. Deletion can require Issue reassignment and protected-reference handling in one transaction.
- Smallest custom seam: `update_issue_type(id, ...)` exposes the existing writable patch, `delete_issue_type(id, reassign_to)` owns identity-bound aggregate deletion, and `reorder_issue_types(project_id, ordered_ids)` is the recorded same-model reorder operation.
- SeaORM transaction/domain module used: `catalog::prepare_issue_type_update` prepares one ActiveModel and delegates revisioned start-state repair to the workflow module. `catalog::prepare_issue_type_reorder` prepares the complete ordered ActiveModel set. Seaolim owns row persistence, commit, and rollback for those fields. `catalog::delete_issue_type` owns the reassignment and deletion transaction.
- Protected fields excluded: update cannot change `project_id`, `level`, `is_pathfind`, timestamps, or workflow revision directly. Reorder derives `sort_order` from the complete supplied identity list.
- Identity/scope binding: update requires one non-null Issue Type ID. Reorder requires one non-null project ID and exactly that project's unique Issue Type IDs.
- Drift/regression test: view tests pin all three SDL fields and cover stale or foreign start-state rollback, exact reorder membership, requested result order, and rollback when one row save fails. The registration contract keeps the superseded central GraphQL module absent.
- Registry entry, if this is genuinely non-CRUD: `reorder_issue_types` remains registered because a complete ordered row set cannot be represented by generated per-row CRUD. Update remains model-shaped CRUD.
