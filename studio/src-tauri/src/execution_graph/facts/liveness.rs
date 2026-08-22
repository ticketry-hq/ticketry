use std::collections::HashSet;

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::entities::{runs::agent_run, terminals::session as terminal_session};
use crate::execution_graph::{types::compact_id, GraphFactsError};

pub(crate) async fn live_work_item_ids(
    database: &impl ConnectionTrait,
    task_ids: &[String],
    exclude_agent_run_id: Option<&str>,
) -> Result<HashSet<String>, GraphFactsError> {
    if task_ids.is_empty() {
        return Ok(HashSet::new());
    }
    let mut run_query = agent_run::Entity::find()
        .filter(agent_run::Column::IssueId.is_in(task_ids.to_vec()))
        .filter(agent_run::Column::EndedAt.is_null());
    let mut terminal_query = terminal_session::Entity::find()
        .filter(terminal_session::Column::TaskId.is_in(task_ids.to_vec()))
        .filter(terminal_session::Column::TerminatedAt.is_null());
    if let Some(run_id) = exclude_agent_run_id {
        let run_id = compact_id(run_id.to_owned());
        run_query = run_query.filter(agent_run::Column::Id.ne(run_id.clone()));
        terminal_query = terminal_query.filter(terminal_session::Column::AgentRunId.ne(run_id));
    }
    let mut live = run_query
        .all(database)
        .await?
        .into_iter()
        .map(|run| run.issue_id)
        .collect::<HashSet<_>>();
    live.extend(
        terminal_query
            .all(database)
            .await?
            .into_iter()
            .map(|session| session.task_id),
    );
    Ok(live)
}

pub async fn has_live_work(
    database: &impl ConnectionTrait,
    task_id: &str,
    exclude_agent_run_id: Option<&str>,
) -> Result<bool, GraphFactsError> {
    Ok(!live_work_item_ids(
        database,
        &[compact_id(task_id.to_owned())],
        exclude_agent_run_id,
    )
    .await?
    .is_empty())
}
