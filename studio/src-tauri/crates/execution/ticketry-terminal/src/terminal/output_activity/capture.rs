use async_trait::async_trait;
use std::sync::Arc;

use super::{TerminalOutputActivityError, TerminalOutputActivityErrorCode};

#[async_trait]
pub trait TerminalScreenCapture: Send + Sync {
    async fn capture(&self, agent_run_id: &str) -> Result<Vec<u8>, TerminalOutputActivityError>;
}

#[derive(Clone)]
pub struct TmuxScreenCapture;

#[async_trait]
impl TerminalScreenCapture for TmuxScreenCapture {
    async fn capture(&self, agent_run_id: &str) -> Result<Vec<u8>, TerminalOutputActivityError> {
        let agent_run_id = agent_run_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let adapter = crate::tmux_adapter::TmuxAdapter::discover().map_err(capture_error)?;
            adapter.capture_screen(&agent_run_id).map_err(capture_error)
        })
        .await
        .map_err(|_| {
            TerminalOutputActivityError::new(
                TerminalOutputActivityErrorCode::CaptureFailed,
                "Terminal output could not be captured.",
            )
        })?
    }
}

fn capture_error(_: crate::tmux_adapter::TmuxAdapterError) -> TerminalOutputActivityError {
    TerminalOutputActivityError::new(
        TerminalOutputActivityErrorCode::CaptureFailed,
        "Terminal output could not be captured.",
    )
}

pub fn production_capture() -> Arc<dyn TerminalScreenCapture> {
    Arc::new(TmuxScreenCapture)
}
