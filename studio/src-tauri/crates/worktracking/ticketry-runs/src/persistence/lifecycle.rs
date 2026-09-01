use sea_orm::{
    sea_query::Expr, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, TransactionTrait,
};
use serde_json::json;

use super::entities::agent_run;
use super::work_item_scope;
use super::{
    run_holding_in, timestamp, EndOfLifeOrigin, LifecycleAcceptance, LifecycleFact,
    LifecycleService, NewStatusEvent, RunsPersistenceError, RunsPersistenceErrorCode,
    TerminalAcceptance, TerminalFact,
};

struct RunState {
    issue_id: String,
    project_id: String,
    status: String,
    ended_at: Option<String>,
    exit_code: Option<i32>,
    provider_session_id: Option<String>,
    lifecycle_state: Option<String>,
    lifecycle_updated_at: Option<String>,
    launch_state: Option<String>,
    launch_model: Option<String>,
}

impl LifecycleService {
    /// Apply one provider lifecycle fact and acknowledge it only after the
    /// authoritative row and its durable status event commit together.
    pub async fn apply_lifecycle_fact(
        &self,
        fact: LifecycleFact,
    ) -> Result<LifecycleAcceptance, RunsPersistenceError> {
        let transaction = self.database().begin().await?;
        let acceptance = self.apply_lifecycle_fact_in(&transaction, fact).await?;
        transaction.commit().await?;
        if acceptance.applied {
            self.events().wake_committed();
        }
        Ok(acceptance)
    }

    pub async fn apply_lifecycle_fact_in(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        fact: LifecycleFact,
    ) -> Result<LifecycleAcceptance, RunsPersistenceError> {
        let occurred_at = timestamp::normalize(&fact.occurred_at)?;
        let state = reduce_kind(&fact.kind).ok_or_else(|| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidLifecycleFact,
                "The lifecycle fact kind is not supported.",
            )
        })?;
        let provider_session_id = fact
            .provider_session_id
            .as_deref()
            .map(validate_provider_session)
            .transpose()?;
        let Some(run) = load_run(transaction, &fact.agent_run_id).await? else {
            return Ok(LifecycleAcceptance {
                accepted: true,
                known_run: false,
                applied: false,
                state: None,
                occurred_at,
                event_cursor: None,
            });
        };

        let provider_changed = provider_session_id.is_some()
            && run
                .provider_session_id
                .as_deref()
                .is_none_or(|value| value.trim().is_empty());
        let lifecycle_changed = if run.ended_at.is_some() {
            false
        } else {
            should_apply_lifecycle(
                run.lifecycle_state.as_deref(),
                run.lifecycle_updated_at.as_deref(),
                state,
                &occurred_at,
            )?
        };

        if !provider_changed && !lifecycle_changed {
            return Ok(LifecycleAcceptance {
                accepted: true,
                known_run: true,
                applied: false,
                state: run.lifecycle_state,
                occurred_at,
                event_cursor: None,
            });
        }

        if provider_changed {
            agent_run::Entity::update_many()
                .col_expr(
                    agent_run::Column::ProviderSessionId,
                    Expr::value(provider_session_id.clone()),
                )
                .filter(agent_run::Column::Id.eq(&fact.agent_run_id))
                .exec(transaction)
                .await?;
        }
        if lifecycle_changed {
            agent_run::Entity::update_many()
                .col_expr(agent_run::Column::LifecycleState, Expr::value(state))
                .col_expr(
                    agent_run::Column::LifecycleUpdatedAt,
                    Expr::value(occurred_at.clone()),
                )
                .filter(agent_run::Column::Id.eq(&fact.agent_run_id))
                .filter(agent_run::Column::EndedAt.is_null())
                .exec(transaction)
                .await?;
        }
        let resulting_state = if lifecycle_changed {
            state.to_owned()
        } else {
            run.lifecycle_state.unwrap_or_else(|| "unknown".to_owned())
        };
        let effective_state = run_holding_in(transaction, &fact.agent_run_id, &occurred_at)
            .await?
            .map(|holding| holding.effective_state)
            .unwrap_or_else(|| resulting_state.clone());
        let event_id = uuid::Uuid::new_v4().simple().to_string();
        let payload = json!({
            "agentRunId": fact.agent_run_id,
            "state": resulting_state,
            "effectiveState": effective_state,
            "occurredAt": occurred_at,
            "providerSessionCaptured": provider_changed,
            "launchState": run.launch_state,
            "launchModel": run.launch_model,
        });
        let cursor = self
            .events()
            .append(
                transaction,
                NewStatusEvent {
                    event_id: &event_id,
                    project_id: &run.project_id,
                    event_kind: "agent_run.lifecycle",
                    payload_version: 1,
                    subject_kind: "agent_run",
                    subject_id: &fact.agent_run_id,
                    agent_run_id: Some(&fact.agent_run_id),
                    automation_attempt_id: None,
                    work_item_id: Some(&run.issue_id),
                    payload: &payload,
                },
            )
            .await?;
        Ok(LifecycleAcceptance {
            accepted: true,
            known_run: true,
            applied: true,
            state: Some(resulting_state),
            occurred_at,
            event_cursor: Some(cursor),
        })
    }

    /// Record terminal authority. Once loss is known, a later generic exit
    /// cannot erase it; active provider facts are independently frozen by the
    /// ended_at guard above.
    pub async fn apply_terminal_fact(
        &self,
        fact: TerminalFact,
    ) -> Result<TerminalAcceptance, RunsPersistenceError> {
        self.apply_terminal_fact_attributed(fact, EndOfLifeOrigin::Unattributed)
            .await
    }

    /// Record terminal authority together with what ended the run.
    ///
    /// A caller that knows why the run ended states it here; one that does not
    /// uses `apply_terminal_fact` and the end is recorded as unattributed.
    pub async fn apply_terminal_fact_attributed(
        &self,
        fact: TerminalFact,
        origin: EndOfLifeOrigin,
    ) -> Result<TerminalAcceptance, RunsPersistenceError> {
        let transaction = self.database().begin().await?;
        let acceptance = self
            .apply_terminal_fact_in_attributed(&transaction, fact, origin)
            .await?;
        transaction.commit().await?;
        if acceptance.applied {
            self.events().wake_committed();
        }
        Ok(acceptance)
    }

    /// Terminal authority inside a caller-owned transaction. A launch outcome
    /// settles its effect, owning Automation Attempt, and Agent Run together,
    /// so the run's terminal fact cannot commit apart from the failure that
    /// caused it.
    pub async fn apply_terminal_fact_in(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        fact: TerminalFact,
    ) -> Result<TerminalAcceptance, RunsPersistenceError> {
        self.apply_terminal_fact_in_attributed(transaction, fact, EndOfLifeOrigin::Unattributed)
            .await
    }

    pub async fn apply_terminal_fact_in_attributed(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        fact: TerminalFact,
        origin: EndOfLifeOrigin,
    ) -> Result<TerminalAcceptance, RunsPersistenceError> {
        self.apply_terminal_fact_in_observed(transaction, fact, origin, || Ok(()), || Ok(()))
            .await
    }

    pub async fn apply_terminal_fact_in_observed<F, G>(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        fact: TerminalFact,
        origin: EndOfLifeOrigin,
        after_run_fact: F,
        after_status_append: G,
    ) -> Result<TerminalAcceptance, RunsPersistenceError>
    where
        F: FnOnce() -> Result<(), RunsPersistenceError>,
        G: FnOnce() -> Result<(), RunsPersistenceError>,
    {
        let occurred_at = timestamp::normalize(&fact.occurred_at)?;
        let run = load_run(transaction, &fact.agent_run_id)
            .await?
            .ok_or_else(|| {
                RunsPersistenceError::new(
                    RunsPersistenceErrorCode::NotFound,
                    "The Agent Run does not exist.",
                )
            })?;
        let public_state = fact.outcome.public_state().to_owned();
        if !should_apply_terminal(&run, fact.outcome.status(), fact.exit_code, &occurred_at)? {
            return Ok(TerminalAcceptance {
                applied: false,
                state: if run.status == "lost" {
                    "lost"
                } else {
                    "exited"
                }
                .to_owned(),
                occurred_at,
                event_cursor: None,
            });
        }
        agent_run::Entity::update_many()
            .col_expr(
                agent_run::Column::Status,
                Expr::value(fact.outcome.status()),
            )
            .col_expr(agent_run::Column::EndedAt, Expr::value(occurred_at.clone()))
            .col_expr(
                agent_run::Column::LifecycleState,
                Expr::value(fact.outcome.lifecycle_state()),
            )
            .col_expr(
                agent_run::Column::LifecycleUpdatedAt,
                Expr::value(occurred_at.clone()),
            )
            .col_expr(
                agent_run::Column::ExitCode,
                Expr::value(fact.exit_code.or(run.exit_code)),
            )
            .filter(agent_run::Column::Id.eq(&fact.agent_run_id))
            .exec(transaction)
            .await?;
        after_run_fact()?;
        let effective_state = run_holding_in(transaction, &fact.agent_run_id, &occurred_at)
            .await?
            .map(|holding| holding.effective_state)
            .unwrap_or_else(|| public_state.clone());
        let event_id = uuid::Uuid::new_v4().simple().to_string();
        let payload = json!({
            "agentRunId": fact.agent_run_id,
            "state": public_state,
            "effectiveState": effective_state,
            "outcome": fact.outcome.status(),
            "occurredAt": occurred_at,
            "exitCode": fact.exit_code,
            "launchState": run.launch_state,
            "launchModel": run.launch_model,
        });
        let cursor = self
            .events()
            .append(
                transaction,
                NewStatusEvent {
                    event_id: &event_id,
                    project_id: &run.project_id,
                    event_kind: "agent_run.terminal",
                    payload_version: 1,
                    subject_kind: "agent_run",
                    subject_id: &fact.agent_run_id,
                    agent_run_id: Some(&fact.agent_run_id),
                    automation_attempt_id: None,
                    work_item_id: Some(&run.issue_id),
                    payload: &payload,
                },
            )
            .await?;
        after_status_append()?;
        // The run has ended; record what ended it, alongside the status and
        // lifecycle state that cannot say.
        super::end_of_life::record_run_ended(
            &fact.agent_run_id,
            Some(&run.project_id),
            origin,
            fact.outcome.status(),
            fact.exit_code.or(run.exit_code),
        );
        Ok(TerminalAcceptance {
            applied: true,
            state: public_state,
            occurred_at,
            event_cursor: Some(cursor),
        })
    }
}

fn reduce_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "session_start" => Some("starting"),
        "turn_start" | "tool_use" => Some("working"),
        "awaiting_input" => Some("needs_input"),
        "permission_required" => Some("permission_required"),
        "turn_complete" => Some("turn_complete"),
        "idle" => Some("quiet"),
        "error" => Some("error"),
        "session_end" => Some("exited"),
        _ => None,
    }
}

fn validate_provider_session(value: &str) -> Result<String, RunsPersistenceError> {
    if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::InvalidProviderSession,
            "The provider session identity is invalid.",
        ));
    }
    Ok(value.to_owned())
}

fn should_apply_lifecycle(
    current_state: Option<&str>,
    current_at: Option<&str>,
    incoming_state: &str,
    incoming_at: &str,
) -> Result<bool, RunsPersistenceError> {
    let Some(current_at) = current_at else {
        return Ok(true);
    };
    let ordering =
        timestamp::parse(incoming_at)?.cmp(&timestamp::parse(current_at).map_err(|_| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidHistory,
                "The stored lifecycle timestamp is invalid.",
            )
        })?);
    // Providers routinely emit two facts inside one second. An exact duplicate
    // stays a no-op; a differing state at the same timestamp resolves in
    // arrival order, which is the only ordering the provider gives us.
    if ordering.is_lt() || (ordering.is_eq() && current_state == Some(incoming_state)) {
        return Ok(false);
    }
    Ok(true)
}

fn should_apply_terminal(
    run: &RunState,
    incoming_status: &str,
    incoming_exit_code: Option<i32>,
    incoming_at: &str,
) -> Result<bool, RunsPersistenceError> {
    let Some(current_at) = run.ended_at.as_deref() else {
        return Ok(true);
    };
    let ordering =
        timestamp::parse(incoming_at)?.cmp(&timestamp::parse(current_at).map_err(|_| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::InvalidHistory,
                "The stored terminal timestamp is invalid.",
            )
        })?);
    if ordering.is_lt() || (run.status == "lost" && incoming_status != "lost") {
        return Ok(false);
    }
    if run.status == incoming_status && (run.exit_code.is_some() || incoming_exit_code.is_none()) {
        return Ok(false);
    }
    Ok(!(ordering.is_eq() && run.status == incoming_status))
}

async fn load_run(
    database: &impl ConnectionTrait,
    run_id: &str,
) -> Result<Option<RunState>, RunsPersistenceError> {
    let Some(run) = agent_run::Entity::find_by_id(run_id).one(database).await? else {
        return Ok(None);
    };
    let Some(project_id) = work_item_scope::project_id(database, &run.issue_id).await? else {
        return Ok(None);
    };
    Ok(Some(RunState {
        issue_id: run.issue_id,
        project_id,
        status: run.status,
        ended_at: run.ended_at,
        exit_code: run.exit_code,
        provider_session_id: run.provider_session_id,
        lifecycle_state: run.lifecycle_state,
        lifecycle_updated_at: run.lifecycle_updated_at,
        launch_state: run.launch_state,
        launch_model: run.launch_model,
    }))
}
