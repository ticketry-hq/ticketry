//! Bounded Claude startup observation through the owned tmux capture seam.

use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait};
use ticketry_entities::{agent_run, session};
use ticketry_launch::{provider_contract, Provider, StartupScreen};
use ticketry_runs::{format_timestamp, LifecycleFact, RunsServices};

use super::{TerminalOutputActivityError, TerminalOutputActivityService};

const STARTUP_WINDOW: chrono::Duration = chrono::Duration::seconds(120);
const CAPTURE_INTERVAL: Duration = Duration::from_secs(1);
const TRUST_REASON: &str =
    "Claude is waiting for folder trust. Open its terminal to approve or decline.";

impl TerminalOutputActivityService {
    /// Inspect one live Claude startup. The persisted run start bounds recovery
    /// across desktop restarts; no terminal bytes are stored or returned.
    pub async fn observe_claude_startup(
        &self,
        agent_run_id: &str,
    ) -> Result<(), TerminalOutputActivityError> {
        self.observe_claude_startup_at(agent_run_id, Utc::now())
            .await
    }

    async fn observe_claude_startup_at(
        &self,
        agent_run_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), TerminalOutputActivityError> {
        let Some(run) = agent_run::Entity::find_by_id(agent_run_id)
            .filter(agent_run::Column::EndedAt.is_null())
            .one(&self.database)
            .await?
        else {
            return Ok(());
        };
        if run.agent.as_deref() != Some("claude")
            || !matches!(
                run.lifecycle_state.as_deref(),
                Some("starting" | "needs_input")
            )
            || (run.lifecycle_state.as_deref() == Some("needs_input")
                && run.attention_reason.as_deref() != Some(TRUST_REASON))
        {
            return Ok(());
        }
        let Ok(started_at) = DateTime::parse_from_rfc3339(&run.started_at) else {
            return Ok(());
        };
        if self.authorize(agent_run_id).await.is_err() {
            return Ok(());
        }
        let elapsed = now.signed_duration_since(started_at);
        if elapsed >= STARTUP_WINDOW {
            if run.lifecycle_state.as_deref() == Some("starting") {
                self.record_startup_fact(agent_run_id, "startup_attention", now)
                    .await?;
            }
            return Ok(());
        }
        if elapsed < chrono::Duration::zero() || !self.claim_startup_capture(agent_run_id) {
            return Ok(());
        }
        let screen = match self.capture.capture(agent_run_id).await {
            Ok(screen) => screen,
            Err(_) => return Ok(()), // uncertainty is reported at the deadline
        };
        let captured_at = Utc::now();
        if captured_at.signed_duration_since(started_at) >= STARTUP_WINDOW {
            if run.lifecycle_state.as_deref() == Some("starting")
                && self.authorize(agent_run_id).await.is_ok()
            {
                self.record_startup_fact(agent_run_id, "startup_attention", captured_at)
                    .await?;
            }
            return Ok(());
        }
        let kind = match provider_contract(Provider::Claude).classify_startup_screen(&screen) {
            StartupScreen::TrustDialog if run.lifecycle_state.as_deref() == Some("starting") => {
                Some("startup_trust")
            }
            StartupScreen::ReadyComposer => Some("idle"),
            _ => None,
        };
        if let Some(kind) = kind {
            if self.authorize(agent_run_id).await.is_ok() {
                self.record_startup_fact(agent_run_id, kind, captured_at)
                    .await?;
            }
        }
        Ok(())
    }

    async fn record_startup_fact(
        &self,
        agent_run_id: &str,
        kind: &str,
        now: DateTime<Utc>,
    ) -> Result<(), TerminalOutputActivityError> {
        RunsServices::new(self.database.clone())
            .lifecycle()
            .apply_lifecycle_fact(LifecycleFact {
                agent_run_id: agent_run_id.to_owned(),
                kind: kind.to_owned(),
                occurred_at: format_timestamp(now),
                provider_session_id: None,
            })
            .await
            .map_err(|_| {
                TerminalOutputActivityError::from(sea_orm::DbErr::Custom(
                    "startup observation could not be recorded".to_owned(),
                ))
            })?;
        Ok(())
    }

    fn claim_startup_capture(&self, agent_run_id: &str) -> bool {
        let now = Instant::now();
        let mut captures = self
            .last_startup_capture
            .lock()
            .expect("startup capture map poisoned");
        captures.retain(|_, at| now.duration_since(*at) < CAPTURE_INTERVAL);
        if captures
            .get(agent_run_id)
            .is_some_and(|at| now.duration_since(*at) < CAPTURE_INTERVAL)
        {
            return false;
        }
        captures.insert(agent_run_id.to_owned(), now);
        true
    }
}

/// The pass only selects live current-namespace sessions. Per-run observation
/// rechecks authority because a process may exit while enumeration is pending.
pub(super) async fn observe_claude_startups(service: &TerminalOutputActivityService) {
    let Ok(namespace) = crate::tmux_adapter::current_runtime_namespace() else {
        return;
    };
    let runs = agent_run::Entity::find()
        .select_only()
        .column(agent_run::Column::Id)
        .filter(agent_run::Column::Agent.eq("claude"))
        .filter(agent_run::Column::EndedAt.is_null())
        .filter(agent_run::Column::LifecycleState.is_in(["starting", "needs_input"]))
        .into_query();
    let Ok(ids) = session::Entity::find()
        .select_only()
        .column(session::Column::AgentRunId)
        .filter(session::Column::RuntimeNamespace.eq(namespace))
        .filter(session::Column::TerminatedAt.is_null())
        .filter(session::Column::RuntimeCleanupPending.eq(false))
        .filter(session::Column::AgentRunId.in_subquery(runs))
        .order_by_asc(session::Column::CreatedAt)
        .into_tuple::<String>()
        .all(&service.database)
        .await
    else {
        return;
    };
    for id in ids {
        let _ = service.observe_claude_startup(&id).await;
    }
}
