use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseTransaction, EntityTrait};

use crate::entities::terminals::{launch_material, session};
use crate::runs_persistence::{LaunchSettlementParticipant, LifecycleFact, RunsPersistenceError};

use super::material::material_conflict;
use super::{TerminalLaunchBoundary, TerminalLaunchCheckpoint, VerifiedTerminalRuntime};

pub(super) struct SessionSettlement {
    pub(super) material: launch_material::Model,
    pub(super) runtime: VerifiedTerminalRuntime,
    pub(super) lifecycle: crate::runs_persistence::LifecycleService,
    pub(super) checkpoints: super::checkpoint::LaunchCheckpoints,
}

#[async_trait]
impl LaunchSettlementParticipant for SessionSettlement {
    async fn settle_applied_in(
        &self,
        transaction: &DatabaseTransaction,
        _effect: &crate::runs_persistence::LaunchEffectRecord,
        settled_at: &str,
        _runtime_evidence: &serde_json::Value,
    ) -> Result<(), RunsPersistenceError> {
        if let Some(existing) = session::Entity::find_by_id(&self.material.agent_run_id)
            .one(transaction)
            .await?
        {
            if existing.tmux_session_name != self.runtime.tmux_session_name
                || existing.runtime_namespace.as_deref() != Some(&self.runtime.runtime_namespace)
            {
                return Err(material_conflict());
            }
        } else {
            session::ActiveModel {
                agent_run_id: Set(self.material.agent_run_id.clone()),
                tmux_session_name: Set(self.runtime.tmux_session_name.clone()),
                task_id: Set(self.material.task_id.clone()),
                module_id: Set(self.material.module_id.clone()),
                project_id: Set(self.material.project_id.clone()),
                created_at: Set(settled_at.to_owned()),
                terminated_at: Set(None),
                scope: Set(self.material.scope.clone()),
                doc_rel_path: Set(self.material.doc_rel_path.clone()),
                runtime_cleanup_pending: Set(false),
                runtime_namespace: Set(Some(self.runtime.runtime_namespace.clone())),
                output_identity: Set(None),
                output_sequence: Set(0),
                last_output_at: Set(Some(settled_at.to_owned())),
                agent: Set(self.material.provider.clone()),
            }
            .insert(transaction)
            .await?;
        }
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::SessionInserted)
            .await
            .map_err(|error| {
                RunsPersistenceError::new(
                    crate::runs_persistence::RunsPersistenceErrorCode::Storage,
                    error.to_string(),
                )
            })?;
        self.lifecycle
            .apply_lifecycle_fact_in(
                transaction,
                LifecycleFact {
                    agent_run_id: self.material.agent_run_id.clone(),
                    kind: if self.material.scope == "shell" {
                        "session_start"
                    } else {
                        "turn_start"
                    }
                    .to_owned(),
                    occurred_at: Utc::now().to_rfc3339(),
                    provider_session_id: None,
                },
            )
            .await?;
        Ok(())
    }
}
