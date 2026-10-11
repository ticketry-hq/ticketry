//! Persist a continued handoff's advisory observation with its status event.

use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait, IntoActiveModel, TransactionTrait};
use serde_json::json;

use super::entities::agent_run;
use super::{timestamp, LifecycleService, NewStatusEvent, RunsPersistenceError};

impl LifecycleService {
    /// Replace the advisory observation after rechecking a continued run's
    /// actual provider and directory. Never changes lifecycle state or launch intent.
    pub async fn set_stage_skill_availability(
        &self,
        agent_run_id: &str,
        report: Option<String>,
    ) -> Result<(), RunsPersistenceError> {
        let transaction = self.database().begin().await?;
        let Some(run) = agent_run::Entity::find_by_id(agent_run_id)
            .one(&transaction)
            .await?
        else {
            return Ok(());
        };
        if run.ended_at.is_some() || run.stage_skill_availability == report {
            return Ok(());
        }
        let previous =
            super::run_holding_in(&transaction, agent_run_id, &timestamp::format(Utc::now()))
                .await?;
        let observed = Utc::now();
        let observed = match previous.as_ref() {
            // Apollo compares browser timestamps at millisecond precision.
            Some(holding) => observed
                .max(timestamp::parse(&holding.updated_at)? + chrono::Duration::milliseconds(1)),
            None => observed,
        };
        let occurred_at = timestamp::format(observed);
        let mut patch = run.into_active_model();
        patch.stage_skill_availability = Set(report);
        patch.lifecycle_updated_at = Set(Some(occurred_at.clone()));
        patch.update(&transaction).await?;
        if let Some(holding) =
            super::run_holding_in(&transaction, agent_run_id, &occurred_at).await?
        {
            let event_id = uuid::Uuid::new_v4().simple().to_string();
            let payload = json!({
                "agentRunId": agent_run_id,
                "state": holding.state,
                "effectiveState": holding.effective_state,
                "occurredAt": occurred_at,
                "run": holding,
            });
            self.events()
                .append(
                    &transaction,
                    NewStatusEvent {
                        event_id: &event_id,
                        project_id: &holding.project_id,
                        event_kind: "agent_run.lifecycle",
                        payload_version: 1,
                        subject_kind: "agent_run",
                        subject_id: agent_run_id,
                        agent_run_id: Some(agent_run_id),
                        automation_attempt_id: None,
                        work_item_id: holding.task_id.as_deref(),
                        payload: &payload,
                    },
                )
                .await?;
        }
        transaction.commit().await?;
        self.events().wake_committed();
        Ok(())
    }
}
