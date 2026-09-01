use chrono::{SecondsFormat, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait,
};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::terminal::cleanup::{CleanupCause, CleanupEffectIdentity, RuntimeInventory};
use crate::tmux_adapter::{
    InventoryConflictKind, InventoryEntry, OwnedSession, PersistedSessionName,
};
use ticketry_entities::{
    {agent_run, launch_effect},
    {cleanup_effect, launch_material, session},
    issue,
};

use super::service::TerminalReconciliationService;
use super::{
    ReconciledUnrecordedRuntime, ReconciliationCheckpoint, RuntimeConflictDiagnostic,
    TerminalReconciliationError, UnrecordedRuntimeDecision,
};

#[derive(Default)]
pub(super) struct InventoryReport {
    pub unrecorded: Vec<ReconciledUnrecordedRuntime>,
    pub conflicts: Vec<RuntimeConflictDiagnostic>,
    pub unavailable: bool,
}

impl TerminalReconciliationService {
    pub(super) async fn reconcile_inventory(
        &self,
    ) -> Result<InventoryReport, TerminalReconciliationError> {
        let RuntimeInventory::Available(entries) = self.runtime.inventory().await else {
            return Ok(InventoryReport {
                unavailable: true,
                ..InventoryReport::default()
            });
        };
        let mut report = InventoryReport::default();
        for entry in entries {
            match entry {
                InventoryEntry::Conflict { fingerprint, kind } => {
                    report
                        .conflicts
                        .push(RuntimeConflictDiagnostic { fingerprint, kind });
                }
                InventoryEntry::Owned {
                    session: runtime,
                    legacy_namespace,
                } => {
                    if session::Entity::find_by_id(&runtime.agent_run_id)
                        .one(&self.database)
                        .await?
                        .is_some()
                    {
                        continue;
                    }
                    match self
                        .reconcile_owned_runtime(&runtime, legacy_namespace)
                        .await?
                    {
                        Some(value) => report.unrecorded.push(value),
                        None => report.conflicts.push(RuntimeConflictDiagnostic {
                            fingerprint: fingerprint(&runtime.agent_run_id),
                            kind: InventoryConflictKind::Ambiguous,
                        }),
                    }
                }
            }
        }
        Ok(report)
    }

    async fn reconcile_owned_runtime(
        &self,
        runtime: &OwnedSession,
        legacy_namespace: bool,
    ) -> Result<Option<ReconciledUnrecordedRuntime>, TerminalReconciliationError> {
        let material = launch_material::Entity::find()
            .filter(launch_material::Column::AgentRunId.eq(&runtime.agent_run_id))
            .one(&self.database)
            .await?;
        if let Some(material) = material {
            let effect = launch_effect::Entity::find_by_id(&material.effect_id)
                .one(&self.database)
                .await?;
            if let Some(effect) = effect {
                if effect.state == "applied" {
                    self.adopt_applied_runtime(&material, runtime).await?;
                    return Ok(Some(result(
                        runtime,
                        legacy_namespace,
                        UnrecordedRuntimeDecision::Adopted,
                    )));
                }
                if matches!(effect.state.as_str(), "prepared" | "leased") {
                    return Ok(Some(result(
                        runtime,
                        legacy_namespace,
                        UnrecordedRuntimeDecision::PendingLaunch,
                    )));
                }
            }
        }
        if self
            .quarantine_owned_runtime(runtime, legacy_namespace)
            .await?
        {
            Ok(Some(result(
                runtime,
                legacy_namespace,
                UnrecordedRuntimeDecision::Quarantined,
            )))
        } else {
            Ok(None)
        }
    }

    async fn adopt_applied_runtime(
        &self,
        material: &launch_material::Model,
        runtime: &OwnedSession,
    ) -> Result<(), TerminalReconciliationError> {
        let transaction = self.database.begin().await?;
        if session::Entity::find_by_id(&runtime.agent_run_id)
            .one(&transaction)
            .await?
            .is_none()
        {
            session_model(material, runtime, false)
                .insert(&transaction)
                .await?;
            self.checkpoints.reached(
                &runtime.agent_run_id,
                ReconciliationCheckpoint::TerminalSessionUpdated,
            )?;
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn quarantine_owned_runtime(
        &self,
        runtime: &OwnedSession,
        legacy_namespace: bool,
    ) -> Result<bool, TerminalReconciliationError> {
        let Some(run) = agent_run::Entity::find_by_id(&runtime.agent_run_id)
            .one(&self.database)
            .await?
        else {
            return Ok(false);
        };
        let Some(work_item) = issue::Entity::find_by_id(&run.issue_id)
            .one(&self.database)
            .await?
        else {
            return Ok(false);
        };
        let Some(module_id) = work_item.module_id.clone() else {
            return Ok(false);
        };
        if run.scope == "docchat" {
            return Ok(false);
        }
        let Some(agent) = run.agent.clone() else {
            return Ok(false);
        };

        let identity = CleanupEffectIdentity::predetermined(
            &runtime.agent_run_id,
            CleanupCause::OwnedOrphan,
            &runtime.runtime_namespace,
        )?;
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
        let transaction = self.database.begin().await?;
        if session::Entity::find_by_id(&runtime.agent_run_id)
            .one(&transaction)
            .await?
            .is_none()
        {
            session::ActiveModel {
                agent_run_id: Set(runtime.agent_run_id.clone()),
                tmux_session_name: Set(
                    PersistedSessionName::for_owned_session(runtime).into_string()
                ),
                task_id: Set(work_item.id),
                module_id: Set(module_id),
                project_id: Set(work_item.project_id),
                created_at: Set(now.clone()),
                terminated_at: Set(None),
                scope: Set(run.scope),
                doc_rel_path: Set(None),
                runtime_cleanup_pending: Set(true),
                runtime_namespace: Set(Some(runtime.runtime_namespace.clone())),
                output_identity: Set(None),
                output_sequence: Set(0),
                last_output_at: Set(None),
                agent: Set(Some(agent)),
            }
            .insert(&transaction)
            .await?;
        }
        if cleanup_effect::Entity::find_by_id(&identity.effect_id)
            .one(&transaction)
            .await?
            .is_none()
        {
            cleanup_effect::ActiveModel {
                effect_id: Set(identity.effect_id),
                agent_run_id: Set(runtime.agent_run_id.clone()),
                cause: Set(CleanupCause::OwnedOrphan.as_str().to_owned()),
                state: Set("prepared".to_owned()),
                lease_owner: Set(None),
                lease_expires_at: Set(None),
                attempt_count: Set(0),
                last_error_code: Set(Some("terminal_owned_orphan_quarantined".to_owned())),
                last_error_message: Set(Some(
                    "Owned runtime is waiting for quarantine grace.".to_owned(),
                )),
                runtime_evidence: Set(Some(json!({
                    "classification": "owned_orphan",
                    "legacyNamespace": legacy_namespace,
                    "runtimeState": if runtime.running { "running" } else { "exited" },
                }))),
                created_at: Set(now.clone()),
                updated_at: Set(now),
                applied_at: Set(None),
            }
            .insert(&transaction)
            .await?;
        }
        self.checkpoints.reached(
            &runtime.agent_run_id,
            ReconciliationCheckpoint::CleanupScheduled,
        )?;
        transaction.commit().await?;
        Ok(true)
    }
}

fn session_model(
    material: &launch_material::Model,
    runtime: &OwnedSession,
    cleanup_pending: bool,
) -> session::ActiveModel {
    session::ActiveModel {
        agent_run_id: Set(material.agent_run_id.clone()),
        tmux_session_name: Set(PersistedSessionName::for_owned_session(runtime).into_string()),
        task_id: Set(material.task_id.clone()),
        module_id: Set(material.module_id.clone()),
        project_id: Set(material.project_id.clone()),
        created_at: Set(Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)),
        terminated_at: Set(None),
        scope: Set(material.scope.clone()),
        doc_rel_path: Set(material.doc_rel_path.clone()),
        runtime_cleanup_pending: Set(cleanup_pending),
        runtime_namespace: Set(Some(runtime.runtime_namespace.clone())),
        output_identity: Set(None),
        output_sequence: Set(0),
        last_output_at: Set(None),
        agent: Set(material.provider.clone()),
    }
}

fn result(
    runtime: &OwnedSession,
    legacy_namespace: bool,
    decision: UnrecordedRuntimeDecision,
) -> ReconciledUnrecordedRuntime {
    ReconciledUnrecordedRuntime {
        agent_run_id: runtime.agent_run_id.clone(),
        decision,
        legacy_namespace,
    }
}

fn fingerprint(value: &str) -> String {
    let digest = Sha256::digest(format!("ticketry-runtime-conflict-v1\0{value}").as_bytes());
    format!("{digest:x}")[..16].to_owned()
}
