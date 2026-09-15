//! Ending a work item's previous agent sessions before a replacement launch.
//!
//! A fresh launch must own the work item alone: every still-open agent
//! session is cleaned up before the destination spawns, and a failure to end
//! them settles the launching Automation Attempt so it cannot wait forever.

use sea_orm::DatabaseConnection;

use ticketry_runs::{AttemptOutcome, RunsServices};
use ticketry_terminal::{CleanupCause, TerminalCleanupService};
use ticketry_work_management::launch_policy::{mark_delivered, CallerScope, LaunchPolicyDecision};

use super::handoff;

/// End every live agent session the work item still owns, then either return
/// so the replacement can launch or spend the decision and settle the attempt
/// with the failure. A destination that cannot launch leaves the current
/// agent alone, and execute_accepted must not spawn until the kill completes.
pub(super) async fn end_live_agents(
    database: &DatabaseConnection,
    cleanup: &TerminalCleanupService,
    decision: &LaunchPolicyDecision,
    automation_attempt_id: Option<&str>,
) -> Result<(), String> {
    if let Err(error) = end_previous_agents(database, cleanup, decision).await {
        mark_delivered(database, &decision.decision_id)
            .await
            .map_err(|error| error.code().to_owned())?;
        settle_replacement_failure(
            database,
            automation_attempt_id,
            &error,
            decision.caller_scope != CallerScope::Retry,
        )
        .await?;
        return Err("previous_agent_not_ended".to_owned());
    }
    Ok(())
}

async fn end_previous_agents(
    database: &DatabaseConnection,
    cleanup: &TerminalCleanupService,
    decision: &LaunchPolicyDecision,
) -> Result<(), String> {
    let replacement_id = format!("replacement:{}", decision.task_id);
    for session in replacement_sessions(database, &decision.task_id)
        .await
        .map_err(|error| error.to_string())?
    {
        cleanup
            .cleanup(
                &session.agent_run_id,
                CleanupCause::Explicit,
                &replacement_id,
            )
            .await
            .map_err(|error| error.code_str().to_owned())?;
    }
    Ok(())
}

async fn replacement_sessions(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<Vec<ticketry_entities::session::Model>, sea_orm::DbErr> {
    // A failed verified kill marks the row cleanup-pending. Replacement retry
    // must see that row again so it can finish the same cleanup effect.
    handoff::task_sessions(database, task_id, true).await
}

async fn settle_replacement_failure(
    database: &DatabaseConnection,
    automation_attempt_id: Option<&str>,
    detail: &str,
    retryable: bool,
) -> Result<(), String> {
    let Some(attempt_id) = automation_attempt_id else {
        return Ok(());
    };
    RunsServices::new(database.clone())
        .attempts()
        .record_outcome(
            attempt_id,
            AttemptOutcome::Failed {
                error: "The previous agent could not be ended.".to_owned(),
                failure: serde_json::json!({
                    "code": "previous_agent_not_ended",
                    "detail": detail,
                }),
                retryable,
            },
        )
        .await
        .map(drop)
        .map_err(|error| error.to_string())
}
