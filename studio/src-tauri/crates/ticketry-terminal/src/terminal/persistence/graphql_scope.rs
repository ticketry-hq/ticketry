use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QuerySelect, QueryTrait};
use seaography::{
    async_graphql::dynamic::ResolverContext, GuardAction, LifecycleHooksInterface, OperationType,
};

use ticketry_entities::{
    agent_run,
    {session, viewer_lease},
    {issue, project},
};

const TERMINAL_SESSIONS: &str = "AgentTerminalSessions";
const AGENT_RUNS: &str = "AgentRuns";
const VIEWER_LEASES: &str = "AgentRunViewerLeases";

pub struct TerminalReadScope;

impl LifecycleHooksInterface for TerminalReadScope {
    fn entity_guard(
        &self,
        _ctx: &ResolverContext,
        entity: &str,
        action: OperationType,
    ) -> GuardAction {
        if matches!(entity, TERMINAL_SESSIONS | AGENT_RUNS | VIEWER_LEASES)
            && action != OperationType::Read
        {
            return GuardAction::Block(Some("terminal generated mutations are private".to_owned()));
        }
        GuardAction::Allow
    }

    fn entity_filter(
        &self,
        _ctx: &ResolverContext,
        entity: &str,
        action: OperationType,
    ) -> Option<Condition> {
        if action != OperationType::Read {
            return None;
        }
        let namespace = crate::tmux_adapter::current_runtime_namespace().ok();
        match (entity, namespace) {
            (TERMINAL_SESSIONS, Some(namespace)) => Some(
                Condition::all()
                    .add(session::Column::RuntimeNamespace.eq(namespace))
                    .add(session::Column::ProjectId.in_subquery(authorized_project_ids())),
            ),
            (AGENT_RUNS, Some(namespace)) => Some(
                Condition::all()
                    .add(agent_run::Column::IssueId.in_subquery(authorized_issue_ids()))
                    .add(
                        agent_run::Column::Id.in_subquery(current_runtime_agent_run_ids(namespace)),
                    ),
            ),
            (VIEWER_LEASES, Some(namespace)) => Some(
                Condition::all().add(
                    viewer_lease::Column::AgentRunId
                        .in_subquery(current_runtime_agent_run_ids(namespace)),
                ),
            ),
            (TERMINAL_SESSIONS, None) => {
                Some(Condition::all().add(session::Column::AgentRunId.is_null()))
            }
            (AGENT_RUNS, None) => Some(Condition::all().add(agent_run::Column::Id.is_null())),
            (VIEWER_LEASES, None) => {
                Some(Condition::all().add(viewer_lease::Column::AgentRunId.is_null()))
            }
            _ => None,
        }
    }
}

fn authorized_project_ids() -> sea_orm::sea_query::SelectStatement {
    project::Entity::find()
        .select_only()
        .column(project::Column::Id)
        .into_query()
}

fn authorized_issue_ids() -> sea_orm::sea_query::SelectStatement {
    issue::Entity::find()
        .select_only()
        .column(issue::Column::Id)
        .filter(issue::Column::ProjectId.in_subquery(authorized_project_ids()))
        .into_query()
}

fn current_runtime_agent_run_ids(namespace: String) -> sea_orm::sea_query::SelectStatement {
    session::Entity::find()
        .select_only()
        .column(session::Column::AgentRunId)
        .filter(session::Column::RuntimeNamespace.eq(namespace))
        .into_query()
}
