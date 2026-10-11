## AgentRun / update_agent_run

- Generated capability attempted: Seaography rc.9 AgentRuns generated update and the selective generated mutation helper.
- Exact missing behavior: a required concrete run identity, title trimming and blank rejection, and eligibility checked against the existing private instant launch material and AgentRun scope before a title-only write.
- Why `.graphql` selection/alias/adapter is insufficient: callers cannot enforce protected-field absence or persisted eligibility.
- Why `ColumnOptions`, skips, guards, or `entity_filter` are insufficient: skips can allowlist the title and a filter can scope rows, but the generated update retains optional filters and bulk semantics. It cannot bind a required single identity.
- Why a database constraint/default and SeaORM lifecycle hooks are insufficient: generated update bypasses before-save hooks; a simple column constraint cannot bind the concrete identity or check private launch material eligibility.
- Create-one safety: private; arbitrary creation would bypass launch preparation and lifecycle ownership.
- Create-batch safety: private for the same reason, compounded across runs.
- Update safety: generated update remains private; only the restricted title input is public.
- Delete safety: private; deletion bypasses durable terminal cleanup and run history ownership.
- Smallest custom seam: `update_agent_run(id: String!, input: AgentRunUpdateInput!): AgentRuns!`, where the sole input field is required `conversationTitle: String!`.
- SeaORM transaction/domain module used: terminal instant-run ticket title update uses a SeaORM transaction, eligibility join, and an ActiveModel with only the changed title set.
- Protected fields excluded: identity, issue ownership, provider/session identity, scope, status, lifecycle, timestamps, prompts, launch configuration and filesystem fields.
- Identity/scope binding: required exact run ID; live instant AgentRun and private instant launch material must agree on issue identity, with nonempty persisted project and module identities and no document scope. No provider or runtime availability dependency.
- Drift/regression test: `instant_conversation_title_graphql` checks the input allowlist, protected writes, blank rejection, unrelated scopes, durable reopen and unchanged lifecycle/session identity. Runs schema tests prove additive nullable migration preserves existing rows.
- Registry entry, if this is genuinely non-CRUD: none; this is restricted AgentRun model CRUD, recorded in the terminal aggregate custom mutation audit.
