//! Resolving one interactive launch into the material it may run with.
//!
//! Preparation calls this before it writes anything. Everything a caller can
//! state about launch policy — provider, model, reasoning, prompt, required
//! skills, and document identity — is discarded here and rebuilt from
//! authority, so nothing caller-shaped reaches durable launch material.

use crate::launch_authority::{LaunchAuthorityError, LaunchAuthorityErrorCode};

use super::{
    CreateTerminalSession, TerminalLaunchError, TerminalLaunchErrorCode, TerminalLaunchKind,
    TerminalLaunchService,
};

impl TerminalLaunchService {
    /// Replace every caller-controlled launch field with the resolved one.
    /// A shell carries no agent material, so it is the one interactive launch
    /// that has nothing to resolve.
    pub(super) async fn resolve_material(
        &self,
        mut request: CreateTerminalSession,
    ) -> Result<CreateTerminalSession, TerminalLaunchError> {
        if request.kind == TerminalLaunchKind::Shell {
            return Ok(request);
        }
        let authority = self.authority.as_ref().ok_or_else(|| {
            TerminalLaunchError::new(
                TerminalLaunchErrorCode::RuntimeUnavailable,
                "The interactive launch authority is not composed.",
            )
        })?;
        authority
            .resolve(&request)
            .await
            .map_err(authority_error)?
            .apply(&mut request);
        request.validate()?;
        Ok(request)
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
