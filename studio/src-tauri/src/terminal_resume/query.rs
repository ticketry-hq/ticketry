use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseConnection, EntityTrait, ExprTrait, FromQueryResult,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};

use crate::entities::{runs::agent_run, terminals::session, work_management::project};
use crate::launch_planning::{provider_contract, Provider};

use super::scope::ResumeScope;

pub const RESUMABLE_LIMIT: u64 = 10;
pub const RESUMABLE_STATEMENT_LIMIT: usize = 1 + RESUMABLE_LIMIT as usize;

#[derive(Clone)]
pub struct ResumableConversationService {
    database: DatabaseConnection,
}

#[derive(Debug, FromQueryResult)]
struct ProviderConversation {
    provider_session_id: String,
}

impl ResumableConversationService {
    pub fn new(database: DatabaseConnection) -> Self {
        Self { database }
    }

    pub async fn list(
        &self,
        task_id: Option<String>,
        project_id: Option<String>,
        module_id: Option<String>,
    ) -> Result<Vec<agent_run::Model>, sea_orm::DbErr> {
        let scope = ResumeScope::from_query(task_id, project_id, module_id).map_err(|_| {
            sea_orm::DbErr::Custom("The resumable terminal scope is invalid.".into())
        })?;
        let condition = eligible_condition(&scope);
        let groups = agent_run::Entity::find()
            .select_only()
            .column_as(agent_run::Column::ProviderSessionId, "provider_session_id")
            .filter(condition.clone())
            .group_by(agent_run::Column::ProviderSessionId)
            .order_by_desc(Expr::col(agent_run::Column::EndedAt).max())
            .order_by_desc(agent_run::Column::ProviderSessionId)
            .limit(RESUMABLE_LIMIT)
            .into_model::<ProviderConversation>()
            .all(&self.database)
            .await?;

        let mut rows = Vec::with_capacity(groups.len());
        for group in groups {
            if let Some(row) = agent_run::Entity::find()
                .filter(condition.clone())
                .filter(agent_run::Column::ProviderSessionId.eq(group.provider_session_id))
                .order_by_desc(agent_run::Column::EndedAt)
                .order_by_desc(agent_run::Column::StartedAt)
                .order_by_desc(agent_run::Column::Id)
                .one(&self.database)
                .await?
            {
                rows.push(row);
            }
        }
        rows.sort_by(|left, right| {
            right
                .ended_at
                .cmp(&left.ended_at)
                .then_with(|| right.started_at.cmp(&left.started_at))
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(rows)
    }
}

fn eligible_condition(scope: &ResumeScope) -> sea_orm::Condition {
    let session_ids = session::Entity::find()
        .select_only()
        .column(session::Column::AgentRunId)
        .filter(scope.session_condition())
        .filter(session::Column::TerminatedAt.is_not_null())
        .filter(
            session::Column::RuntimeNamespace
                .eq(crate::tmux_adapter::current_runtime_namespace().unwrap_or_default()),
        )
        .filter(session::Column::ProjectId.in_subquery(authorized_project_ids()))
        .into_query();
    let live_provider_sessions = agent_run::Entity::find()
        .select_only()
        .column(agent_run::Column::ProviderSessionId)
        .filter(agent_run::Column::EndedAt.is_null())
        .filter(agent_run::Column::ProviderSessionId.is_not_null())
        .filter(agent_run::Column::ProviderSessionId.ne(""))
        .into_query();
    let live_predecessors = agent_run::Entity::find()
        .select_only()
        .column(agent_run::Column::ResumedFrom)
        .filter(agent_run::Column::EndedAt.is_null())
        .filter(agent_run::Column::ResumedFrom.is_not_null())
        .filter(agent_run::Column::ResumedFrom.ne(""))
        .into_query();

    sea_orm::Condition::all()
        .add(agent_run::Column::Id.in_subquery(session_ids))
        .add(agent_run::Column::EndedAt.is_not_null())
        .add(agent_run::Column::EndedAt.ne(""))
        .add(agent_run::Column::ProviderSessionId.is_not_null())
        .add(agent_run::Column::ProviderSessionId.ne(""))
        .add(agent_run::Column::Agent.is_in(resumable_provider_slugs()))
        .add(agent_run::Column::ProviderSessionId.not_in_subquery(live_provider_sessions))
        .add(agent_run::Column::Id.not_in_subquery(live_predecessors))
}

fn authorized_project_ids() -> sea_orm::sea_query::SelectStatement {
    project::Entity::find()
        .select_only()
        .column(project::Column::Id)
        .into_query()
}

fn resumable_provider_slugs() -> Vec<&'static str> {
    [
        Provider::Claude,
        Provider::Codex,
        Provider::Gemini,
        Provider::Agy,
    ]
    .into_iter()
    .filter(|provider| provider_contract(*provider).supports_resume)
    .map(|provider| provider_contract(provider).slug)
    .collect()
}
