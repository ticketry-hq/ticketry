use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use crate::launch::terminal_session::{TerminalLaunchError, TerminalLaunchErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalLaunchBoundary {
    RequestValidated,
    MaterialPrepared,
    EffectPrepared,
    EffectClaimed,
    PreEffectObserved,
    TmuxCreated,
    OwnershipMetadataWritten,
    SessionInserted,
    EffectAndStatusSettled,
    ResponseReady,
}

#[async_trait]
pub trait TerminalLaunchCheckpoint: Send + Sync {
    async fn checkpoint(&self, boundary: TerminalLaunchBoundary)
        -> Result<(), TerminalLaunchError>;
}

#[derive(Clone, Default)]
pub(crate) struct LaunchCheckpoints {
    stop_at: Arc<Mutex<Option<TerminalLaunchBoundary>>>,
}

impl LaunchCheckpoints {
    pub(crate) fn stopping_at(boundary: TerminalLaunchBoundary) -> Self {
        Self {
            stop_at: Arc::new(Mutex::new(Some(boundary))),
        }
    }
}

#[async_trait]
impl TerminalLaunchCheckpoint for LaunchCheckpoints {
    async fn checkpoint(
        &self,
        boundary: TerminalLaunchBoundary,
    ) -> Result<(), TerminalLaunchError> {
        let mut stop_at = self
            .stop_at
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if stop_at.as_ref() != Some(&boundary) {
            return Ok(());
        }
        stop_at.take();
        Err(TerminalLaunchError::new(
            TerminalLaunchErrorCode::InjectedStop,
            format!("Terminal launch stopped at {boundary:?}."),
        ))
    }
}
