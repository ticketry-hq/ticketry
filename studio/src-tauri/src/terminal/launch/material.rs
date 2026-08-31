use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, DatabaseConnection, DatabaseTransaction, EntityTrait,
};
use serde_json::json;

use ticketry_entities::terminals::launch_material;
use ticketry_runs::persistence::{
    LaunchIntent, LaunchPreparationParticipant, PrepareLaunchRequest, RunSnapshot,
    RunsPersistenceError, RunsPersistenceErrorCode,
};

use super::service::{compact, storage};
use ticketry_launch::terminal_session::{
    CreateTerminalSession, TerminalLaunchError, TerminalLaunchErrorCode,
};

const MATERIAL_VERSION: i32 = 1;

#[derive(Clone)]
pub(super) struct PreparedMaterial {
    request: CreateTerminalSession,
    launch_state: Option<String>,
    pub(super) effect_id: String,
    pub(super) agent_run_id: String,
}

pub(super) struct CombinedPreparation<'a> {
    material: &'a PreparedMaterial,
    participant: &'a dyn LaunchPreparationParticipant,
}

impl PreparedMaterial {
    pub(super) fn new(request: &CreateTerminalSession, launch_state: Option<String>) -> Self {
        Self {
            request: request.clone(),
            launch_state,
            effect_id: request.effect_id(),
            agent_run_id: request.agent_run_id(),
        }
    }

    pub(super) fn runs_request(&self) -> PrepareLaunchRequest {
        PrepareLaunchRequest {
            intent: LaunchIntent {
                effect_id: self.effect_id.clone(),
                agent_run_id: self.agent_run_id.clone(),
                automation_attempt_id: self.request.automation_attempt_id.clone(),
                request_id: self.request.client_request_id.clone(),
                project_id: self.request.project_id.clone(),
                issue_id: self.request.issue_id.clone(),
                scope: self.request.kind.scope().to_owned(),
                provider: self.request.provider.clone(),
                target_kind: self.request.kind.target_kind().to_owned(),
                target_id: self.request.target_id.clone(),
                policy_reference: self.request.policy_reference.clone(),
            },
            snapshot: RunSnapshot {
                model: self.request.model.clone(),
                reasoning: self.request.reasoning.clone(),
                initial_prompt: self.request.prompt.clone(),
                unattended: matches!(
                    self.request.kind,
                    ticketry_launch::terminal_session::TerminalLaunchKind::Automation
                ),
                resumed_from: self.request.resume_from_agent_run_id.clone(),
                launch_state: self.launch_state.clone(),
                launch_model: matches!(
                    self.request.kind,
                    ticketry_launch::terminal_session::TerminalLaunchKind::Task
                        | ticketry_launch::terminal_session::TerminalLaunchKind::Automation
                )
                .then(|| self.request.model.clone())
                .flatten(),
                ..RunSnapshot::default()
            },
        }
    }

    pub(super) fn with<'a>(
        &'a self,
        participant: &'a dyn LaunchPreparationParticipant,
    ) -> CombinedPreparation<'a> {
        CombinedPreparation {
            material: self,
            participant,
        }
    }

    pub(super) async fn load(
        &self,
        database: &DatabaseConnection,
    ) -> Result<launch_material::Model, TerminalLaunchError> {
        launch_material::Entity::find_by_id(&self.effect_id)
            .one(database)
            .await
            .map_err(storage)?
            .ok_or_else(|| {
                TerminalLaunchError::new(
                    TerminalLaunchErrorCode::Conflict,
                    "The prepared launch material is missing.",
                )
            })
    }

    fn row(&self) -> launch_material::ActiveModel {
        launch_material::ActiveModel {
            effect_id: Set(self.effect_id.clone()),
            agent_run_id: Set(self.agent_run_id.clone()),
            schema_version: Set(MATERIAL_VERSION),
            request_id: Set(self.request.client_request_id.clone()),
            issue_id: Set(compact(&self.request.issue_id)),
            project_id: Set(compact(&self.request.project_id)),
            module_id: Set(compact(&self.request.module_id)),
            task_id: Set(compact(&self.request.terminal_task_id())),
            provider: Set(self.request.provider.clone()),
            model: Set(self.request.model.clone()),
            reasoning: Set(self.request.reasoning.clone()),
            scope: Set(self.request.kind.scope().to_owned()),
            doc_rel_path: Set(self.request.document_relative_path.clone()),
            prompt: Set(self.request.prompt.clone()),
            resume_from_agent_run_id: Set(self.request.resume_from_agent_run_id.clone()),
            required_skills: Set(json!(self.request.required_skills)),
            working_directory_identity: Set(self.request.working_directory_identity.clone()),
            design_directory_identity: Set(self.request.design_directory_identity.clone()),
            initial_columns: Set(i32::from(self.request.columns)),
            initial_rows: Set(i32::from(self.request.rows)),
            created_at: sea_orm::ActiveValue::NotSet,
        }
    }

    fn matches(&self, row: &launch_material::Model) -> bool {
        row.agent_run_id == self.agent_run_id
            && row.request_id == self.request.client_request_id
            && row.issue_id == compact(&self.request.issue_id)
            && row.project_id == compact(&self.request.project_id)
            && row.module_id == compact(&self.request.module_id)
            && row.task_id == compact(&self.request.terminal_task_id())
            && row.provider == self.request.provider
            && row.model == self.request.model
            && row.reasoning == self.request.reasoning
            && row.scope == self.request.kind.scope()
            && row.doc_rel_path == self.request.document_relative_path
            && row.prompt == self.request.prompt
            && row.resume_from_agent_run_id == self.request.resume_from_agent_run_id
            && row.required_skills == json!(self.request.required_skills)
            && row.working_directory_identity == self.request.working_directory_identity
            && row.design_directory_identity == self.request.design_directory_identity
            && row.initial_columns == i32::from(self.request.columns)
            && row.initial_rows == i32::from(self.request.rows)
    }
}

#[async_trait]
impl LaunchPreparationParticipant for CombinedPreparation<'_> {
    async fn prepare_in(
        &self,
        transaction: &DatabaseTransaction,
        intent: &LaunchIntent,
        reused: bool,
    ) -> Result<(), RunsPersistenceError> {
        self.material
            .prepare_in(transaction, intent, reused)
            .await?;
        self.participant
            .prepare_in(transaction, intent, reused)
            .await
    }
}

#[async_trait]
impl LaunchPreparationParticipant for PreparedMaterial {
    async fn prepare_in(
        &self,
        transaction: &DatabaseTransaction,
        _intent: &LaunchIntent,
        reused: bool,
    ) -> Result<(), RunsPersistenceError> {
        if reused {
            let row = launch_material::Entity::find_by_id(&self.effect_id)
                .one(transaction)
                .await?
                .ok_or_else(material_conflict)?;
            if !self.matches(&row) {
                return Err(material_conflict());
            }
            return Ok(());
        }
        self.row()
            .insert(transaction)
            .await
            .map(|_| ())
            .map_err(|_| material_conflict())
    }
}

pub(super) fn material_conflict() -> RunsPersistenceError {
    RunsPersistenceError::new(
        RunsPersistenceErrorCode::LaunchConflict,
        "The client request identity is bound to different terminal launch material.",
    )
}
