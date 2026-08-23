use std::sync::Arc;

use sea_orm::{DatabaseConnection, EntityTrait};

use crate::entities::{terminals::session, work_management::issue};
use crate::launch_authority::InteractiveLaunchAuthority;
use crate::runs_persistence::LaunchPreparationParticipant;
use crate::runs_persistence::RunsServices;

use super::checkpoint::LaunchCheckpoints;
use super::material::PreparedMaterial;
use super::{
    CreateTerminalSession, TerminalLaunchBoundary, TerminalLaunchCheckpoint, TerminalLaunchError,
    TerminalLaunchErrorCode, TerminalLaunchRuntime,
};

pub(crate) struct AcceptedTerminalLaunch {
    material: PreparedMaterial,
    pub agent_run_id: String,
    effect_state: String,
}

#[derive(Clone)]
pub struct TerminalLaunchService {
    pub(super) database: DatabaseConnection,
    pub(super) runs: RunsServices,
    pub(super) runtime: Arc<dyn TerminalLaunchRuntime>,
    /// Resolves the launch material an interactive request is allowed to run
    /// with. A service composed without one cannot accept an interactive
    /// agent launch at all: there is no caller-supplied fallback.
    pub(super) authority: Option<Arc<dyn InteractiveLaunchAuthority>>,
    pub(super) lease_owner: String,
    pub(super) checkpoints: LaunchCheckpoints,
}

impl TerminalLaunchService {
    pub fn new(database: DatabaseConnection, runtime: Arc<dyn TerminalLaunchRuntime>) -> Self {
        Self {
            runs: RunsServices::new(database.clone()),
            database,
            runtime,
            authority: None,
            lease_owner: uuid::Uuid::new_v4().simple().to_string(),
            checkpoints: LaunchCheckpoints::default(),
        }
    }

    /// Compose the interactive launch authority. Without it the service still
    /// serves policy-resolved launches, recovery, and module shells, but
    /// refuses every interactive agent launch.
    pub fn with_authority(mut self, authority: Arc<dyn InteractiveLaunchAuthority>) -> Self {
        self.authority = Some(authority);
        self
    }

    #[doc(hidden)]
    pub fn stopping_once_at(mut self, boundary: TerminalLaunchBoundary) -> Self {
        self.checkpoints = LaunchCheckpoints::stopping_at(boundary);
        self
    }

    pub async fn create(
        &self,
        request: CreateTerminalSession,
    ) -> Result<session::Model, TerminalLaunchError> {
        self.create_inner(request, None).await
    }

    /// Create a module-scoped login shell from the only identities a client is
    /// allowed to choose. Project and launch routing come from the module row.
    pub async fn create_module_shell(
        &self,
        client_request_id: String,
        module_id: String,
        columns: u16,
        rows: u16,
    ) -> Result<session::Model, TerminalLaunchError> {
        let module = issue::Entity::find_by_id(compact(&module_id))
            .one(&self.database)
            .await
            .map_err(storage)?
            .filter(|row| !row.is_archived && row.r#type == "module")
            .ok_or_else(|| {
                TerminalLaunchError::new(
                    TerminalLaunchErrorCode::InvalidRequest,
                    "The shell module is unavailable.",
                )
            })?;
        self.create(CreateTerminalSession {
            client_request_id,
            project_id: module.project_id,
            issue_id: module.id.clone(),
            module_id: module.id.clone(),
            target_id: module.id.clone(),
            kind: super::TerminalLaunchKind::Shell,
            provider: None,
            model: None,
            reasoning: None,
            policy_reference: None,
            prompt: None,
            resume_from_agent_run_id: None,
            automation_attempt_id: None,
            required_skills: Vec::new(),
            working_directory_identity: format!("module:{}", compact(&module.id)),
            design_directory_identity: None,
            document_relative_path: None,
            columns,
            rows,
        })
        .await
    }

    pub(crate) async fn prepare(
        &self,
        request: CreateTerminalSession,
    ) -> Result<AcceptedTerminalLaunch, TerminalLaunchError> {
        self.prepare_inner(request, None, None).await
    }

    pub(crate) async fn prepare_policy(
        &self,
        request: CreateTerminalSession,
        launch_state: Option<String>,
    ) -> Result<AcceptedTerminalLaunch, TerminalLaunchError> {
        self.prepare_inner(request, None, Some(launch_state)).await
    }

    pub(crate) async fn prepare_with_participant(
        &self,
        request: CreateTerminalSession,
        participant: &dyn LaunchPreparationParticipant,
    ) -> Result<AcceptedTerminalLaunch, TerminalLaunchError> {
        self.prepare_inner(request, Some(participant), None).await
    }

    pub(crate) async fn execute_accepted(
        &self,
        accepted: AcceptedTerminalLaunch,
    ) -> Result<session::Model, TerminalLaunchError> {
        if accepted.effect_state == "applied" {
            return self.respond(&accepted.agent_run_id).await;
        }
        let row = accepted.material.load(&self.database).await?;
        self.execute(row).await
    }

    async fn create_inner(
        &self,
        request: CreateTerminalSession,
        participant: Option<&dyn LaunchPreparationParticipant>,
    ) -> Result<session::Model, TerminalLaunchError> {
        let accepted = self.prepare_inner(request, participant, None).await?;
        self.execute_accepted(accepted).await
    }

    async fn prepare_inner(
        &self,
        request: CreateTerminalSession,
        participant: Option<&dyn LaunchPreparationParticipant>,
        policy_launch_state: Option<Option<String>>,
    ) -> Result<AcceptedTerminalLaunch, TerminalLaunchError> {
        request.validate()?;
        crate::terminal_resume::validate_resume_request(&self.database, &request).await?;
        self.validate_scope(&request).await?;
        self.runtime.preflight(&request).await?;
        // A launch that did not arrive with resolved policy is interactive:
        // its provider, model, reasoning, prompt, required skills, and
        // document identity are rebuilt from authority before anything is
        // persisted, so the caller's copies never reach durable material.
        let request = if participant.is_none() && policy_launch_state.is_none() {
            self.resolve_material(request).await?
        } else {
            request
        };
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::RequestValidated)
            .await?;

        let launch_state = match policy_launch_state {
            Some(snapshot) => snapshot,
            None => self.resolve_launch_state(&request).await?,
        };
        let material = PreparedMaterial::new(&request, launch_state);
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::MaterialPrepared)
            .await?;
        let prepared = match participant {
            Some(participant) => {
                let combined = material.with(participant);
                self.runs
                    .effects()
                    .prepare_launch_with(material.runs_request(), &combined)
                    .await?
            }
            None => {
                self.runs
                    .effects()
                    .prepare_launch_with(material.runs_request(), &material)
                    .await?
            }
        };
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::EffectPrepared)
            .await?;

        Ok(AcceptedTerminalLaunch {
            agent_run_id: material.agent_run_id.clone(),
            material,
            effect_state: prepared.effect.state,
        })
    }

    async fn resolve_launch_state(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<Option<String>, TerminalLaunchError> {
        if !matches!(
            request.kind,
            super::TerminalLaunchKind::Task | super::TerminalLaunchKind::Automation
        ) {
            return Ok(None);
        }
        let row = issue::Entity::find_by_id(compact(&request.issue_id))
            .one(&self.database)
            .await
            .map_err(storage)?
            .ok_or_else(|| {
                TerminalLaunchError::new(
                    TerminalLaunchErrorCode::InvalidRequest,
                    "The terminal launch Work Item is unavailable.",
                )
            })?;
        let Some(state_id) = row.state_id else {
            return Ok(None);
        };
        crate::entities::work_management::state::Entity::find_by_id(state_id)
            .one(&self.database)
            .await
            .map_err(storage)
            .map(|state| state.map(|state| state.name))
    }

    async fn validate_scope(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<(), TerminalLaunchError> {
        match request.kind {
            super::TerminalLaunchKind::Planning
            | super::TerminalLaunchKind::Instant
            | super::TerminalLaunchKind::Shell => {
                let submitted = issue::Entity::find_by_id(compact(&request.issue_id))
                    .one(&self.database)
                    .await
                    .map_err(storage)?
                    .ok_or_else(|| {
                        TerminalLaunchError::new(
                            TerminalLaunchErrorCode::InvalidRequest,
                            "The terminal launch scope is unavailable.",
                        )
                    })?;
                let module_id = if !submitted.is_archived && submitted.r#type == "module" {
                    submitted.id.clone()
                } else {
                    crate::worktree_status::owner::resolve(&self.database, &request.issue_id)
                        .await
                        .map_err(|_| {
                            TerminalLaunchError::new(
                                TerminalLaunchErrorCode::InvalidRequest,
                                "The terminal launch scope has no module owner.",
                            )
                        })?
                        .module_id
                        .ok_or_else(|| {
                            TerminalLaunchError::new(
                                TerminalLaunchErrorCode::InvalidRequest,
                                "The terminal launch scope has no module owner.",
                            )
                        })?
                };
                if compact(&module_id) != compact(&request.module_id)
                    || compact(&submitted.project_id) != compact(&request.project_id)
                {
                    return Err(TerminalLaunchError::new(
                        TerminalLaunchErrorCode::InvalidRequest,
                        "The terminal launch module does not match its project.",
                    ));
                }
            }
            super::TerminalLaunchKind::Task
            | super::TerminalLaunchKind::DocumentChat
            | super::TerminalLaunchKind::Automation => {
                let owner =
                    crate::worktree_status::owner::resolve(&self.database, &request.issue_id)
                        .await
                        .map_err(|_| {
                            TerminalLaunchError::new(
                                TerminalLaunchErrorCode::InvalidRequest,
                                "The terminal launch Work Item is unavailable.",
                            )
                        })?;
                if owner.module_id.as_deref().map(compact).as_deref()
                    != Some(compact(&request.module_id).as_str())
                {
                    return Err(TerminalLaunchError::new(
                        TerminalLaunchErrorCode::InvalidRequest,
                        "The terminal launch module does not own its Work Item.",
                    ));
                }
            }
        }
        let expected_target = match request.kind {
            super::TerminalLaunchKind::Task | super::TerminalLaunchKind::Automation => {
                compact(&request.issue_id)
            }
            super::TerminalLaunchKind::Planning
            | super::TerminalLaunchKind::Instant
            | super::TerminalLaunchKind::Shell => compact(&request.module_id),
            super::TerminalLaunchKind::DocumentChat => compact(&request.target_id),
        };
        if compact(&request.target_id) != expected_target {
            return Err(TerminalLaunchError::new(
                TerminalLaunchErrorCode::InvalidRequest,
                "The terminal launch target does not match its scope.",
            ));
        }
        let expected_workspace = match request.kind {
            super::TerminalLaunchKind::Task | super::TerminalLaunchKind::Automation => {
                format!("task:{}", compact(&request.issue_id))
            }
            super::TerminalLaunchKind::Planning
            | super::TerminalLaunchKind::Instant
            | super::TerminalLaunchKind::Shell => {
                format!("module:{}", compact(&request.module_id))
            }
            super::TerminalLaunchKind::DocumentChat => {
                format!("document:{}", compact(&request.target_id))
            }
        };
        if request.working_directory_identity != expected_workspace {
            return Err(TerminalLaunchError::new(
                TerminalLaunchErrorCode::InvalidRequest,
                "The terminal launch workspace identity does not match its scope.",
            ));
        }
        Ok(())
    }

    pub(super) async fn authoritative(
        &self,
        run_id: &str,
    ) -> Result<session::Model, TerminalLaunchError> {
        session::Entity::find_by_id(run_id)
            .one(&self.database)
            .await
            .map_err(storage)?
            .ok_or_else(|| {
                TerminalLaunchError::new(
                    TerminalLaunchErrorCode::Conflict,
                    "The applied launch has no authoritative Terminal Session.",
                )
            })
    }

    pub(super) async fn respond(
        &self,
        run_id: &str,
    ) -> Result<session::Model, TerminalLaunchError> {
        let authoritative = self.authoritative(run_id).await?;
        self.checkpoints
            .checkpoint(TerminalLaunchBoundary::ResponseReady)
            .await?;
        Ok(authoritative)
    }
}

pub(super) fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

pub(super) fn storage(error: sea_orm::DbErr) -> TerminalLaunchError {
    TerminalLaunchError::new(
        TerminalLaunchErrorCode::Storage,
        format!("Terminal launch storage failed: {error}"),
    )
}
