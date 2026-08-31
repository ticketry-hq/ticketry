//! Resolving one interactive launch into the material it may run with.
//!
//! Preparation calls this before it writes anything. Everything a caller can
//! state about launch policy — provider, model, reasoning, prompt, required
//! skills, and document identity — is discarded here and rebuilt from
//! authority, so nothing caller-shaped reaches durable launch material.

use ticketry_diagnostics::launch_trace as trace;
use ticketry_launch::authority::{LaunchAuthorityError, LaunchAuthorityErrorCode};

use ticketry_launch::trace_reasons;

use super::TerminalLaunchService;
use ticketry_launch::terminal_session::{
    CreateTerminalSession, TerminalLaunchError, TerminalLaunchErrorCode, TerminalLaunchKind,
};

impl TerminalLaunchService {
    /// Replace every caller-controlled launch field with the resolved one.
    /// A shell carries no agent material, so it is the one interactive launch
    /// that has nothing to resolve.
    /// Resolves the material an interactive launch may run with, and records
    /// authority establishment and prompt construction as the two outcomes
    /// they are.
    pub(super) async fn resolve_material(
        &self,
        mut request: CreateTerminalSession,
    ) -> Result<CreateTerminalSession, TerminalLaunchError> {
        if request.kind == TerminalLaunchKind::Shell {
            trace::admitted(trace::stages::AUTHORITY_RESOLVED)
                .with("authorityRequired", false)
                .with("promptConstructed", false)
                .record();
            return Ok(request);
        }
        let Some(authority) = self.authority.as_ref() else {
            trace::refused(trace::stages::AUTHORITY_RESOLVED, "authority_not_composed")
                .with("authorityRequired", true)
                .record();
            return Err(TerminalLaunchError::new(
                TerminalLaunchErrorCode::RuntimeUnavailable,
                "The interactive launch authority is not composed.",
            ));
        };
        match authority.resolve(&request).await {
            Ok(material) => material.apply(&mut request),
            Err(error) => {
                trace::refused(
                    trace::stages::AUTHORITY_RESOLVED,
                    trace_reasons::authority_reason(error.code),
                )
                .with("authorityRequired", true)
                .record();
                return Err(authority_error(error));
            }
        }
        note_resolved_material(&request);
        if let Err(error) = request.validate() {
            trace::refused(trace::stages::AUTHORITY_RESOLVED, error.code_str())
                .with("authorityRequired", true)
                .with("promptConstructed", request.prompt.is_some())
                .record();
            return Err(error);
        }
        trace::admitted(trace::stages::AUTHORITY_RESOLVED)
            .with("authorityRequired", true)
            .with("promptConstructed", request.prompt.is_some())
            .with(
                "promptCharacters",
                request.prompt.as_deref().map_or(0, str::len),
            )
            .with("requiredSkillCount", request.required_skills.len())
            .record();
        Ok(request)
    }
}

/// Authority is where an interactive launch's provider, model, and reasoning
/// first become known, so every later stage can record them.
fn note_resolved_material(request: &CreateTerminalSession) {
    if let Some(attempt) = trace::current() {
        attempt.note(|facts| {
            facts.provider = request.provider.clone();
            facts.model = request.model.clone();
            facts.reasoning = request.reasoning.clone();
        });
    }
}

fn authority_error(error: LaunchAuthorityError) -> TerminalLaunchError {
    let code = match error.code {
        LaunchAuthorityErrorCode::PolicyRejected | LaunchAuthorityErrorCode::Unresolvable => {
            TerminalLaunchErrorCode::InvalidRequest
        }
        LaunchAuthorityErrorCode::UnusableFolder => TerminalLaunchErrorCode::UnusableFolder,
        LaunchAuthorityErrorCode::Storage => TerminalLaunchErrorCode::Storage,
    };
    TerminalLaunchError::new(code, error.to_string())
}
