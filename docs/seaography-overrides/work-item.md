# Work Item mutation override

## Work Item create and delete

- Generated capability attempted: Seaography create-one and delete.
- Exact missing behavior: Create allocates the project sequence and revision, resolves the issue type, workflow birth state, parent and module ancestry, optionally creates module presentation state, inserts the description, and records a durable fact in one transaction. Delete rejects parents with children, advances the project revision, removes relation rows through database cascades, deletes the Work Item, and records its deletion fact in one transaction.
- Why `.graphql` selection/alias/adapter is insufficient: Selection can reshape a generated result but cannot add aggregate writes or transaction rules.
- Why `ColumnOptions`, skips, guards, or `entity_filter` are insufficient: These tools can restrict fields and rows. They cannot allocate counters, resolve hierarchy, clean relations, or publish facts atomically.
- Why a database constraint/default and SeaORM lifecycle hooks are insufficient: The rules span Project, Issue, State, IssueType, ModulePresentation, relation rows, and durable status facts. The pinned generated create-one has no surrounding aggregate transaction, and generated delete bypasses ActiveModel delete hooks.
- Create-one safety: Private. The generated input cannot preserve the aggregate transaction.
- Create-batch safety: Private. There is no caller contract, and per-row aggregate creation would require shared sequence, hierarchy, and fact semantics.
- Update safety: Private. The generated optional filter can affect many rows and bypasses Work Item patch dispatch. The existing restricted compatibility field remains authored for a separately gated migration.
- Delete safety: Private. Generated delete accepts an optional filter, bypasses delete hooks, and cannot preserve child checks, revision allocation, relation cleanup, and facts as one operation.
- Smallest custom seam: Model-shaped `create_work_item` and identity-bound `delete_work_item` views with the existing arguments, results, and error extensions.
- SeaORM transaction/domain module used: `work_management::commands::work_items::{create, delete}`.
- Protected fields excluded: IDs, sequence, rank, module ancestry, revisions, timestamps, archive state, and workspace tab order are not caller-writable during create. Delete accepts only one required Work Item identity.
- Identity/scope binding: Create requires one concrete Project and IssueType identity. Delete requires one concrete Work Item identity.
- Drift/regression test: Nested-view SDL and authorization tests plus the existing Work Management creation, hierarchy, deletion, relation-cleanup, rollback, and status-fact integration tests.
- Registry entry, if this is genuinely non-CRUD: None. These are restricted model CRUD seams, not named domain operations.

## Work Item update

- Generated capability attempted: Seaography update.
- Exact missing behavior: Generated update accepts an optional filter and can change many rows. Ticketry binds one Work Item identity and allows one domain change per request. Details, workflow transition, hierarchy, blocker graph, archive cascade, and workspace tab order each retain their existing validation, revision, repair, transaction, and durable-fact behavior.
- Why `.graphql` selection/alias/adapter is insufficient: Selection can reshape the returned Work Item but cannot enforce write routing or domain transactions.
- Why `ColumnOptions`, skips, guards, or `entity_filter` are insufficient: These tools can restrict fields and rows. They cannot require exactly one domain path, run workflow policy, repair hierarchy, reject blocker cycles, archive descendants, normalize tab order, or publish facts atomically.
- Why a database constraint/default and SeaORM lifecycle hooks are insufficient: The rules inspect and change related rows across Project, State, IssueType, blocker edges, descendants, module ancestry, terminal sessions, and status facts. The pinned generated update bypasses pre-save hooks and exposes a multi-row filter.
- Create-one safety: Covered by the separate create override above.
- Create-batch safety: Private. There is no caller contract.
- Update safety: Private. Generated update cannot preserve concrete identity, the one-domain-change rule, or the domain transactions.
- Delete safety: Covered by the separate delete override above.
- Smallest custom seam: The existing identity-bound `update_work_item` field with its existing arguments and result. Its GraphQL view selects one route, then delegates to focused internal handlers for details, transition, reparent, blockers, archive, or tab order.
- SeaORM transaction/domain module used: `work_management::commands::work_items::{update, archive}`, `commands::workflow::transition`, `commands::hierarchy::reparent`, `commands::blockers::replace`, and `work_management::workspace_tab_order::update`.
- Protected fields excluded: Project, sequence, rank, module ancestry, revisions, and timestamps remain server-owned. Parent, state, blockers, archive, and tab order are writable only through their restricted domain paths.
- Identity/scope binding: The field requires one concrete Work Item identity. Each handler validates any related identity against the Work Item's project and type.
- Drift/regression test: The existing frontend operation documents, generated contract drift check, Work Management GraphQL update integration tests, workspace tab-order integration test, and Studio write-runtime acceptance test.
- Registry entry, if this is genuinely non-CRUD: None. This is a restricted model update seam, not a named domain operation.
