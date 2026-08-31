//! A launch authority that resolves to exactly what the caller submitted.
//!
//! Production composes the real
//! [`muxed_studio_lib::launch::authority::LaunchAuthorityService`], which is
//! proved in `interactive_launch_authority`. Tests that exercise preparation,
//! effect journalling, runtime settlement, and recovery care about the launch
//! machinery rather than about policy, so they install this instead and keep
//! stating their launch material in the request.

#![allow(dead_code)]

use std::sync::Arc;

use async_trait::async_trait;
use muxed_studio_lib::launch::authority::{
    InteractiveLaunchAuthority, LaunchAuthorityError, ResolvedLaunchMaterial,
};
use muxed_studio_lib::launch::terminal_session::CreateTerminalSession;
use muxed_studio_lib::terminal::launch::{TerminalLaunchRuntime, TerminalLaunchService};
use sea_orm::DatabaseConnection;

pub struct SubmittedLaunchAuthority;

#[async_trait]
impl InteractiveLaunchAuthority for SubmittedLaunchAuthority {
    async fn resolve(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        Ok(ResolvedLaunchMaterial {
            provider: request.provider.clone(),
            model: request.model.clone(),
            reasoning: request.reasoning.clone(),
            policy_reference: request.policy_reference.clone(),
            prompt: request.prompt.clone(),
            required_skills: request.required_skills.clone(),
            design_directory_identity: request.design_directory_identity.clone(),
            document_relative_path: request.document_relative_path.clone(),
        })
    }
}

/// One terminal launch service that can accept interactive launches.
pub fn launch_service(
    database: DatabaseConnection,
    runtime: Arc<dyn TerminalLaunchRuntime>,
) -> TerminalLaunchService {
    TerminalLaunchService::new(database, runtime).with_authority(Arc::new(SubmittedLaunchAuthority))
}
