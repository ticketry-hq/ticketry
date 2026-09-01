use chrono::{Duration, Utc};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use std::collections::HashMap;

use ticketry_entities::session;

use super::entities::agent_run;
use super::work_item_scope::{self, HoldingScope};
use super::{
    timestamp, AgentRunHolding, QueryProjectionService, RunsPersistenceError,
    RunsPersistenceErrorCode,
};

const STATUS_WINDOW_DAYS: i64 = 30;
const STALL_AFTER_SECONDS: i64 = 60;

struct HoldingRow {
    id: String,
    issue_id: String,
    project_id: String,
    issue_type: String,
    module_id: String,
    agent: Option<String>,
    scope: String,
    started_at: String,
    status: String,
    ended_at: Option<String>,
    lifecycle_state: Option<String>,
    lifecycle_updated_at: Option<String>,
    provider_session_id: Option<String>,
    launch_state: Option<String>,
    launch_model: Option<String>,
    output_sequence: i64,
    last_output_at: Option<String>,
}

impl QueryProjectionService {
    pub async fn run_holdings(
        &self,
        project_id: &str,
        task_id: Option<&str>,
    ) -> Result<Vec<AgentRunHolding>, RunsPersistenceError> {
        self.run_holdings_at(project_id, task_id, &timestamp::format(Utc::now()))
            .await
    }

    pub async fn run_holdings_at(
        &self,
        project_id: &str,
        task_id: Option<&str>,
        now: &str,
    ) -> Result<Vec<AgentRunHolding>, RunsPersistenceError> {
        run_holdings_on(self.database(), project_id, task_id, now).await
    }
}

async fn run_holdings_on(
    database: &impl ConnectionTrait,
    project_id: &str,
    task_id: Option<&str>,
    now: &str,
) -> Result<Vec<AgentRunHolding>, RunsPersistenceError> {
    let now = timestamp::parse(now)?;
    let cutoff = now - Duration::days(STATUS_WINDOW_DAYS);
    let project_id = database_uuid(project_id);
    let task_id = task_id.map(database_uuid);
    let issue_ids =
        work_item_scope::ids_for_project(database, &project_id, task_id.as_deref()).await?;
    if issue_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = agent_run::Entity::find()
        .filter(agent_run::Column::IssueId.is_in(issue_ids))
        .filter(agent_run::Column::Scope.ne("docchat"))
        .all(database)
        .await?;
    let terminal_rows = session::Entity::find()
        .filter(session::Column::AgentRunId.is_in(rows.iter().map(|run| run.id.clone())))
        .all(database)
        .await?
        .into_iter()
        .map(|row| (row.agent_run_id.clone(), row))
        .collect::<HashMap<_, _>>();
    let scopes = work_item_scope::holding_scopes(
        database,
        rows.iter().map(|run| run.issue_id.clone()).collect(),
    )
    .await?
    .into_iter()
    .map(|scope| (scope.id.clone(), scope))
    .collect::<HashMap<_, _>>();
    let mut holdings = rows
        .into_iter()
        .filter_map(|run| {
            let scope = scopes.get(&run.issue_id)?;
            let terminal = terminal_rows.get(&run.id);
            Some(holding_row(run, scope, terminal))
        })
        .map(|row| project(row, now))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|holding| {
            holding.ended_at.is_none()
                || holding
                    .updated
                    .as_ref()
                    .is_some_and(|updated| *updated >= cutoff)
        })
        .map(|holding| holding.value)
        .collect::<Vec<_>>();
    holdings.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.agent_run_id.cmp(&left.agent_run_id))
    });
    Ok(holdings)
}

/// Build an event projection through the same mapper the snapshot uses.
pub async fn run_holding_in(
    database: &impl ConnectionTrait,
    agent_run_id: &str,
    now: &str,
) -> Result<Option<AgentRunHolding>, RunsPersistenceError> {
    let Some(run) = agent_run::Entity::find_by_id(agent_run_id)
        .one(database)
        .await?
    else {
        return Ok(None);
    };
    if run.scope == "docchat" {
        return Ok(None);
    }
    let Some(scope) = work_item_scope::holding_scopes(database, vec![run.issue_id.clone()])
        .await?
        .into_iter()
        .next()
    else {
        return Ok(None);
    };
    let terminal = session::Entity::find_by_id(agent_run_id)
        .one(database)
        .await?;
    Ok(Some(
        project(
            holding_row(run, &scope, terminal.as_ref()),
            timestamp::parse(now)?,
        )?
        .value,
    ))
}

struct ProjectedHolding {
    value: AgentRunHolding,
    ended_at: Option<String>,
    updated: Option<chrono::DateTime<Utc>>,
}

fn project(
    row: HoldingRow,
    now: chrono::DateTime<Utc>,
) -> Result<ProjectedHolding, RunsPersistenceError> {
    let started = history_timestamp(&row.started_at)?;
    let lifecycle = row
        .lifecycle_updated_at
        .as_deref()
        .map(history_timestamp)
        .transpose()?;
    let ended = row.ended_at.as_deref().map(history_timestamp).transpose()?;
    let output = row
        .last_output_at
        .as_deref()
        .map(history_timestamp)
        .transpose()?;
    let updated = [Some(started), lifecycle, output, ended]
        .into_iter()
        .flatten()
        .max()
        .expect("started timestamp is present");
    let state = if row.ended_at.is_some() {
        if row.status == "lost" {
            "lost"
        } else {
            "exited"
        }
        .to_owned()
    } else {
        row.lifecycle_state.unwrap_or_else(|| "unknown".to_owned())
    };
    let effective_state = if !matches!(
        state.as_str(),
        "needs_input" | "permission_required" | "exited" | "lost" | "error"
    ) && output
        .is_some_and(|observed| now - observed >= Duration::seconds(STALL_AFTER_SECONDS))
    {
        "stalled".to_owned()
    } else {
        state.clone()
    };
    Ok(ProjectedHolding {
        value: AgentRunHolding {
            agent_run_id: row.id,
            project_id: canonical_uuid(&row.project_id),
            task_id: (row.issue_type == "task").then(|| canonical_uuid(&row.issue_id)),
            module_id: canonical_uuid(&row.module_id),
            agent: row.agent,
            scope: row.scope,
            started_at: timestamp::format(started),
            state,
            effective_state,
            updated_at: timestamp::format(updated),
            provider_session_id: row.provider_session_id,
            launch_state: row.launch_state,
            launch_model: row.launch_model,
            output_sequence: row.output_sequence,
            last_output_at: row.last_output_at,
        },
        ended_at: row.ended_at,
        updated: Some(updated),
    })
}

fn history_timestamp(value: &str) -> Result<chrono::DateTime<Utc>, RunsPersistenceError> {
    timestamp::parse(value).map_err(|_| {
        RunsPersistenceError::new(
            RunsPersistenceErrorCode::InvalidHistory,
            "Stored Agent Run history contains an invalid timestamp.",
        )
    })
}

fn holding_row(
    run: agent_run::Model,
    issue: &HoldingScope,
    terminal: Option<&session::Model>,
) -> HoldingRow {
    HoldingRow {
        id: run.id,
        issue_id: run.issue_id,
        project_id: issue.project_id.clone(),
        issue_type: issue.issue_type.clone(),
        module_id: issue.module_id.clone().unwrap_or_else(|| issue.id.clone()),
        agent: run.agent,
        scope: run.scope,
        started_at: run.started_at,
        status: run.status,
        ended_at: run.ended_at,
        lifecycle_state: run.lifecycle_state,
        lifecycle_updated_at: run.lifecycle_updated_at,
        provider_session_id: run.provider_session_id,
        launch_state: run.launch_state,
        launch_model: run.launch_model,
        output_sequence: terminal.map(|row| row.output_sequence).unwrap_or(0),
        last_output_at: terminal.and_then(|row| row.last_output_at.clone()),
    }
}

fn database_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|identifier| identifier.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

fn canonical_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|identifier| identifier.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
