use blake2::{digest::consts::U16, Blake2b, Digest};
use chrono::Utc;
use sea_orm::{
    sea_query::{Expr, Query},
    ColumnTrait, DatabaseConnection, EntityTrait, ExprTrait, QueryFilter, TransactionTrait,
};
use seaography::CustomOutputType;
use serde::Serialize;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use crate::runs_persistence::{
    run_holding_in, timestamp, NewStatusEvent, RunsServices, StatusEventRepository,
};
use ticketry_entities::{runs::agent_run, terminals::session};

use super::{
    capture::{production_capture, TerminalScreenCapture},
    TerminalOutputActivityError, TerminalOutputActivityErrorCode,
};

const OBSERVATION_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct TerminalOutputObservation {
    pub advanced: bool,
    pub output_sequence: i64,
    pub last_output_at: Option<String>,
}

#[derive(Clone)]
pub struct TerminalOutputActivityService {
    pub(super) database: DatabaseConnection,
    events: StatusEventRepository,
    capture: Arc<dyn TerminalScreenCapture>,
    last_capture: Arc<Mutex<HashMap<String, Instant>>>,
}

impl TerminalOutputActivityService {
    pub fn production(database: DatabaseConnection) -> Self {
        Self::new(database, production_capture())
    }

    pub fn new(database: DatabaseConnection, capture: Arc<dyn TerminalScreenCapture>) -> Self {
        let events = RunsServices::new(database.clone())
            .outbox()
            .events()
            .clone();
        Self {
            database,
            events,
            capture,
            last_capture: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Capture and apply one report. The first report is immediate. Later
    /// reports for the same session start no more than one capture per 500ms.
    pub async fn observe(
        &self,
        agent_run_id: &str,
    ) -> Result<TerminalOutputObservation, TerminalOutputActivityError> {
        validate_identity(agent_run_id)?;
        self.authorize(agent_run_id).await?;
        if !self.claim_capture(agent_run_id) {
            return self.current(agent_run_id).await;
        }
        let screen = self.capture.capture(agent_run_id).await?;
        self.record_captured(agent_run_id, &screen, &timestamp::format(Utc::now()))
            .await
    }

    /// Record bytes captured by the authorized runtime. Kept public for the
    /// browser byte-pump adapter and deterministic service tests.
    pub async fn record_captured(
        &self,
        agent_run_id: &str,
        screen: &[u8],
        observed_at: &str,
    ) -> Result<TerminalOutputObservation, TerminalOutputActivityError> {
        validate_identity(agent_run_id)?;
        let observed_at = timestamp::normalize(observed_at).map_err(|_| {
            TerminalOutputActivityError::new(
                TerminalOutputActivityErrorCode::StorageFailed,
                "Terminal output activity could not be recorded.",
            )
        })?;
        let identity = output_identity(screen);
        let transaction = self.database.begin().await?;
        let run_ids = Query::select()
            .column(agent_run::Column::Id)
            .from(agent_run::Entity)
            .and_where(agent_run::Column::EndedAt.is_null())
            .to_owned();
        let updated = session::Entity::update_many()
            .col_expr(session::Column::OutputIdentity, Expr::value(identity))
            .col_expr(
                session::Column::OutputSequence,
                Expr::col(session::Column::OutputSequence).add(1),
            )
            .col_expr(
                session::Column::LastOutputAt,
                Expr::value(observed_at.clone()),
            )
            .filter(session::Column::AgentRunId.eq(agent_run_id))
            .filter(session::Column::TerminatedAt.is_null())
            .filter(session::Column::AgentRunId.in_subquery(run_ids))
            .filter(
                sea_orm::Condition::any()
                    .add(session::Column::OutputIdentity.is_null())
                    .add(session::Column::OutputIdentity.ne(output_identity(screen))),
            )
            .exec(&transaction)
            .await?;
        let current = session::Entity::find_by_id(agent_run_id)
            .one(&transaction)
            .await?
            .ok_or_else(not_authorized)?;
        if updated.rows_affected == 0 {
            transaction.commit().await?;
            return Ok(observation(false, &current));
        }

        let mut published = false;
        if current.scope != "docchat" {
            let holding = run_holding_in(&transaction, agent_run_id, &observed_at)
                .await?
                .ok_or_else(not_authorized)?;
            let event_id = uuid::Uuid::new_v4().simple().to_string();
            let payload = json!({
                "type": "terminal_activity",
                "at": observed_at,
                "run": holding,
            });
            self.events
                .append(
                    &transaction,
                    NewStatusEvent {
                        event_id: &event_id,
                        project_id: &current.project_id,
                        event_kind: "agent_run.terminal_activity",
                        payload_version: 1,
                        subject_kind: "agent_run",
                        subject_id: agent_run_id,
                        agent_run_id: Some(agent_run_id),
                        automation_attempt_id: None,
                        work_item_id: Some(status_work_item_id(&current)),
                        payload: &payload,
                    },
                )
                .await?;
            published = true;
        }
        transaction.commit().await?;
        if published {
            self.events.wake_committed();
        }
        Ok(observation(true, &current))
    }

    async fn authorize(&self, agent_run_id: &str) -> Result<(), TerminalOutputActivityError> {
        let Some(row) = session::Entity::find_by_id(agent_run_id)
            .filter(session::Column::TerminatedAt.is_null())
            .one(&self.database)
            .await?
        else {
            return Err(not_authorized());
        };
        let run_is_live = agent_run::Entity::find_by_id(agent_run_id)
            .filter(agent_run::Column::EndedAt.is_null())
            .one(&self.database)
            .await?
            .is_some();
        let namespace =
            crate::tmux_adapter::current_runtime_namespace().map_err(|_| not_authorized())?;
        if !run_is_live
            || row.runtime_cleanup_pending
            || row.runtime_namespace.as_deref() != Some(&namespace)
        {
            return Err(not_authorized());
        }
        Ok(())
    }

    async fn current(
        &self,
        agent_run_id: &str,
    ) -> Result<TerminalOutputObservation, TerminalOutputActivityError> {
        session::Entity::find_by_id(agent_run_id)
            .one(&self.database)
            .await?
            .map(|row| observation(false, &row))
            .ok_or_else(not_authorized)
    }

    fn claim_capture(&self, agent_run_id: &str) -> bool {
        let now = Instant::now();
        let mut captures = self
            .last_capture
            .lock()
            .expect("output capture map poisoned");
        captures.retain(|_, at| now.duration_since(*at) < Duration::from_secs(60));
        if captures
            .get(agent_run_id)
            .is_some_and(|at| now.duration_since(*at) < OBSERVATION_INTERVAL)
        {
            return false;
        }
        captures.insert(agent_run_id.to_owned(), now);
        true
    }
}

fn observation(advanced: bool, row: &session::Model) -> TerminalOutputObservation {
    TerminalOutputObservation {
        advanced,
        output_sequence: row.output_sequence,
        last_output_at: row.last_output_at.clone(),
    }
}

fn status_work_item_id(row: &session::Model) -> &str {
    if row.scope == "task" {
        &row.task_id
    } else {
        &row.module_id
    }
}

fn output_identity(screen: &[u8]) -> String {
    format!("{:x}", Blake2b::<U16>::digest(screen))
}

fn validate_identity(agent_run_id: &str) -> Result<(), TerminalOutputActivityError> {
    let valid = !agent_run_id.is_empty()
        && agent_run_id.len() <= 128
        && agent_run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid.then_some(()).ok_or_else(|| {
        TerminalOutputActivityError::new(
            TerminalOutputActivityErrorCode::InvalidIdentity,
            "The Terminal Session identity is invalid.",
        )
    })
}

fn not_authorized() -> TerminalOutputActivityError {
    TerminalOutputActivityError::new(
        TerminalOutputActivityErrorCode::NotAuthorized,
        "The Terminal Session is not authorized in this runtime.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_identity_matches_the_existing_blake2b_128_contract() {
        assert_eq!(
            output_identity(b"$ codex\n"),
            "dba96f7929d3f2433f07e34abf6af3b0"
        );
        assert_eq!(output_identity(b"$ codex\n"), output_identity(b"$ codex\n"));
        assert_ne!(output_identity(b"first"), output_identity(b"second"));
    }
}
