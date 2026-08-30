use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::{runs::agent_run, terminals::session};
use crate::launch::planning::{provider_contract, Provider};
use crate::terminal::launch::{
    CreateTerminalSession, TerminalLaunchError, TerminalLaunchErrorCode,
};

use super::scope::{compact, ResumeScope};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ResumeValidationError {
    code: TerminalLaunchErrorCode,
    message: &'static str,
}

impl ResumeValidationError {
    pub(crate) fn wrong_scope() -> Self {
        Self::new(
            TerminalLaunchErrorCode::ResumeWrongScope,
            "The provider conversation does not belong to the requested terminal scope.",
        )
    }

    fn new(code: TerminalLaunchErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl From<ResumeValidationError> for TerminalLaunchError {
    fn from(error: ResumeValidationError) -> Self {
        TerminalLaunchError::new(error.code, error.message)
    }
}

pub(crate) async fn validate_resume_request(
    database: &DatabaseConnection,
    request: &CreateTerminalSession,
) -> Result<(), TerminalLaunchError> {
    let Some(source_id) = request.resume_from_agent_run_id.as_deref() else {
        return Ok(());
    };
    if source_id.trim().is_empty() {
        return Err(error(
            TerminalLaunchErrorCode::ResumeUnknown,
            "The provider conversation is unknown.",
        ));
    }

    let source = agent_run::Entity::find_by_id(source_id)
        .one(database)
        .await
        .map_err(storage)?
        .ok_or_else(|| {
            error(
                TerminalLaunchErrorCode::ResumeUnknown,
                "The provider conversation is unknown.",
            )
        })?;
    let source_session = session::Entity::find_by_id(source_id)
        .one(database)
        .await
        .map_err(storage)?
        .ok_or_else(|| {
            error(
                TerminalLaunchErrorCode::ResumeUnknown,
                "The provider conversation has no terminal history.",
            )
        })?;

    if source.agent.is_none() || source.scope == "shell" {
        return Err(error(
            TerminalLaunchErrorCode::ResumeAgentless,
            "A shell run has no provider conversation to resume.",
        ));
    }

    if source.ended_at.as_deref().is_none_or(str::is_empty)
        || source_session
            .terminated_at
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Err(error(
            TerminalLaunchErrorCode::ResumeActive,
            "The provider conversation is still active.",
        ));
    }
    let provider_session_id = source
        .provider_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            error(
                TerminalLaunchErrorCode::ResumeSessionless,
                "The ended run has no provider session identity.",
            )
        })?;
    let provider = source
        .agent
        .as_deref()
        .ok_or_else(|| {
            error(
                TerminalLaunchErrorCode::ResumeUnsupported,
                "The provider does not support conversation resume.",
            )
        })
        .and_then(|agent| {
            Provider::try_from(agent).map_err(|_| {
                error(
                    TerminalLaunchErrorCode::ResumeUnsupported,
                    "The provider does not support conversation resume.",
                )
            })
        })?;
    if !provider_contract(provider).supports_resume {
        return Err(error(
            TerminalLaunchErrorCode::ResumeUnsupported,
            "The provider does not support conversation resume.",
        ));
    }

    let scope = ResumeScope::from_create(request);
    let issue_matches = match &scope {
        ResumeScope::Task { .. } => compact(&source.issue_id) == compact(&request.issue_id),
        ResumeScope::Scratch { .. } => true,
    };
    if !scope.matches_create(request, &source_session)
        || !issue_matches
        || source.agent != request.provider
    {
        return Err(ResumeValidationError::wrong_scope().into());
    }

    let has_live_successor = agent_run::Entity::find()
        .filter(agent_run::Column::EndedAt.is_null())
        .filter(agent_run::Column::Id.ne(request.agent_run_id()))
        .filter(
            sea_orm::Condition::any()
                .add(agent_run::Column::ResumedFrom.eq(source_id))
                .add(agent_run::Column::ProviderSessionId.eq(provider_session_id)),
        )
        .one(database)
        .await
        .map_err(storage)?
        .is_some();
    if has_live_successor {
        return Err(error(
            TerminalLaunchErrorCode::ResumeAlreadyResumed,
            "The provider conversation already has a live successor.",
        ));
    }
    Ok(())
}

fn error(code: TerminalLaunchErrorCode, message: &'static str) -> TerminalLaunchError {
    TerminalLaunchError::new(code, message)
}

fn storage(error: sea_orm::DbErr) -> TerminalLaunchError {
    TerminalLaunchError::new(
        TerminalLaunchErrorCode::Storage,
        format!("Provider conversation validation failed: {error}"),
    )
}
