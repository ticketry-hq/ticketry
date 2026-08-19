//! Temporary compatibility port for the still-Python terminal capability.
//!
//! An executor performs exactly one claimed effect and reports a typed
//! outcome. It is never a Runs-table writer: it receives no connection, no
//! attempt identity, and no authority to mint a run — only the two identities
//! Rust predetermined for it.

use async_trait::async_trait;

use super::ClaimedLaunch;

/// Proof that the effect was performed. `adopted` distinguishes a runtime this
/// call created from one it found already live under the deterministic
/// identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchRuntimeEvidence {
    pub runtime_id: String,
    pub adopted: bool,
}

/// A typed launch failure. `cleanup_confirmed` is the executor's statement
/// that no external runtime survives; when it is false the effect stays
/// cleanup-pending and application rows are kept.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchExecutorFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub cleanup_confirmed: bool,
}

#[async_trait]
pub trait LaunchExecutor: Send + Sync {
    async fn execute(
        &self,
        claim: ClaimedLaunch,
    ) -> Result<LaunchRuntimeEvidence, LaunchExecutorFailure>;
}
