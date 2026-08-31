//! The port merge preparation launches through.
//!
//! Worktree decides *that* an agent should prepare the merge; which runtime
//! starts it is composed above, so the terminal service never appears here.

use async_trait::async_trait;

use crate::work_management::launch_policy::LaunchPolicyDecision;

use super::{error::MergePreparationError, types::LaunchedAgent};

#[async_trait]
pub trait MergePreparationLauncher: Send + Sync {
    async fn launch(
        &self,
        decision: &LaunchPolicyDecision,
    ) -> Result<LaunchedAgent, MergePreparationError>;
}
