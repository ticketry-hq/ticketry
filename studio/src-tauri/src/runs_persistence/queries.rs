use chrono::{Duration, Utc};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::collections::HashMap;

use super::entities::agent_run;
use super::work_item_scope::{self, HoldingScope};
use super::{
    timestamp, AgentRunHolding, QueryProjectionService, RunsPersistenceError,
    RunsPersistenceErrorCode,
};

const STATUS_WINDOW_DAYS: i64 = 30;

struct HoldingRow {
    id: String,
    issue_id: String,
    project_id: String,
    issue_type: String,
    module_id: String,
    agent: String,
    scope: String,
    started_at: String,
    status: String,
    ended_at: Option<String>,
    lifecycle_state: Option<String>,
    lifecycle_updated_at: Option<String>,
    provider_session_id: Option<String>,
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

    /// Clock-injected authoritative query used by restart/horizon tests and by
    /// snapshot assembly to keep one timestamp baseline.
    pub async fn run_holdings_at(
        &self,
        project_id: &str,
        task_id: Option<&str>,
        now: &str,
    ) -> Result<Vec<AgentRunHolding>, RunsPersistenceError> {
        let now = timestamp::parse(now)?;
        let cutoff = now - Duration::days(STATUS_WINDOW_DAYS);
        let project_id = database_uuid(project_id);
        let task_id = task_id.map(database_uuid);
        let issue_ids =
            work_item_scope::ids_for_project(self.database(), &project_id, task_id.as_deref())
                .await?;
        if issue_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = agent_run::Entity::find()
            .filter(agent_run::Column::IssueId.is_in(issue_ids))
            .filter(agent_run::Column::Scope.ne("docchat"))
            .all(self.database())
            .await?;
        let scopes = work_item_scope::holding_scopes(
            self.database(),
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
                Some(holding_row(run, scope))
            })
            .into_iter()
            .map(project)
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
}

struct ProjectedHolding {
    value: AgentRunHolding,
    ended_at: Option<String>,
    updated: Option<chrono::DateTime<Utc>>,
}

fn project(row: HoldingRow) -> Result<ProjectedHolding, RunsPersistenceError> {
    let started = history_timestamp(&row.started_at)?;
    let lifecycle = row
        .lifecycle_updated_at
        .as_deref()
        .map(history_timestamp)
        .transpose()?;
    let ended = row.ended_at.as_deref().map(history_timestamp).transpose()?;
    let updated = [Some(started), lifecycle, ended]
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
            updated_at: timestamp::format(updated),
            provider_session_id: row.provider_session_id,
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

fn holding_row(run: agent_run::Model, issue: &HoldingScope) -> HoldingRow {
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
