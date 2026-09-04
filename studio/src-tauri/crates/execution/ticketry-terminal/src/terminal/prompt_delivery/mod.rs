//! Backend-owned text delivery to an already-running tmux agent session.

mod transport;
mod types;
mod visibility;

pub use transport::{PromptDeliveryTmux, TmuxPromptDelivery};
pub use types::{DeliveryTimings, PromptDeliveryError, PromptDeliveryFailureReason};

use std::io::Write;
use std::thread;
use std::time::Instant;
use ticketry_launch::{provider_contract, Provider, ProviderContract};
use uuid::Uuid;
use visibility::PasteEvidence;

const INLINE_BUFFER_MAX_BYTES: usize = 8 * 1024;

pub struct PromptDelivery<T> {
    tmux: T,
    timings: DeliveryTimings,
}

impl<T: PromptDeliveryTmux> PromptDelivery<T> {
    pub fn new(tmux: T) -> Self {
        Self::with_timings(tmux, DeliveryTimings::default())
    }

    pub fn with_timings(tmux: T, timings: DeliveryTimings) -> Self {
        Self { tmux, timings }
    }

    pub fn tmux(&self) -> &T {
        &self.tmux
    }

    pub fn stage(
        &mut self,
        provider: Provider,
        run_id: &str,
        text: &str,
    ) -> Result<(), PromptDeliveryError> {
        self.stage_contract(provider_contract(provider), run_id, text)
    }

    pub fn stage_contract(
        &mut self,
        contract: ProviderContract,
        run_id: &str,
        text: &str,
    ) -> Result<(), PromptDeliveryError> {
        let baseline = self.wait_until_ready(contract, run_id)?;
        self.stage_payload(contract, run_id, text, &baseline)
    }

    pub fn submit(
        &mut self,
        provider: Provider,
        run_id: &str,
        text: &str,
    ) -> Result<(), PromptDeliveryError> {
        let contract = provider_contract(provider);
        let baseline = self.wait_until_ready(contract, run_id)?;
        self.submit_from_baseline(contract, run_id, text, &baseline)
    }

    pub fn submit_follow_on(
        &mut self,
        provider: Provider,
        run_id: &str,
        text: &str,
    ) -> Result<(), PromptDeliveryError> {
        let baseline = self.tmux.capture_screen(run_id).map_err(|detail| {
            PromptDeliveryError::new(PromptDeliveryFailureReason::CaptureFailed, detail)
        })?;
        self.submit_from_baseline(provider_contract(provider), run_id, text, &baseline)
    }

    fn submit_from_baseline(
        &mut self,
        contract: ProviderContract,
        run_id: &str,
        text: &str,
        baseline: &[u8],
    ) -> Result<(), PromptDeliveryError> {
        self.stage_payload(contract, run_id, text, baseline)?;
        // Providers debounce paste bursts and may use the first Enter to accept
        // skill completion. Wait 150 ms, then send Enter twice with 50 ms
        // between presses so the completed invocation is submitted.
        thread::sleep(self.timings.paste_settle);
        self.tmux.send_enter(run_id).map_err(|detail| {
            PromptDeliveryError::new(PromptDeliveryFailureReason::SubmissionFailed, detail)
        })?;
        thread::sleep(self.timings.completion_settle);
        self.tmux.send_enter(run_id).map_err(|detail| {
            PromptDeliveryError::new(PromptDeliveryFailureReason::SubmissionFailed, detail)
        })
    }

    fn wait_until_ready(
        &mut self,
        contract: ProviderContract,
        run_id: &str,
    ) -> Result<Vec<u8>, PromptDeliveryError> {
        if contract.ready_composer_marker.is_none() {
            return Err(PromptDeliveryError::new(
                PromptDeliveryFailureReason::ReadinessMarkerMissing,
                format!("provider '{}' has no ready-composer marker", contract.slug),
            ));
        }
        self.tmux.verify_session(run_id).map_err(|detail| {
            PromptDeliveryError::new(
                PromptDeliveryFailureReason::SessionVerificationFailed,
                detail,
            )
        })?;
        let deadline = Instant::now() + self.timings.readiness_timeout;
        loop {
            let screen = self.tmux.capture_screen(run_id).map_err(|detail| {
                PromptDeliveryError::new(PromptDeliveryFailureReason::CaptureFailed, detail)
            })?;
            if Instant::now() >= deadline {
                return Err(PromptDeliveryError::new(
                    PromptDeliveryFailureReason::ReadinessTimeout,
                    format!(
                        "provider '{}' was not ready before the deadline",
                        contract.slug
                    ),
                ));
            }
            if contract.is_ready_composer(&screen) {
                return Ok(screen);
            }
            thread::sleep(self.timings.readiness_poll);
        }
    }

    fn stage_payload(
        &mut self,
        contract: ProviderContract,
        run_id: &str,
        text: &str,
        baseline: &[u8],
    ) -> Result<(), PromptDeliveryError> {
        if text.trim().is_empty() {
            return Err(PromptDeliveryError::new(
                PromptDeliveryFailureReason::InvalidMessage,
                "terminal message must not be empty",
            ));
        }
        let buffer = format!("ticketry-{}", Uuid::new_v4().simple());
        if text.len() <= INLINE_BUFFER_MAX_BYTES {
            self.tmux
                .set_buffer(run_id, &buffer, text)
                .map_err(|detail| {
                    PromptDeliveryError::new(
                        PromptDeliveryFailureReason::BufferCreationFailed,
                        detail,
                    )
                })?;
        } else {
            self.load_large_buffer(run_id, &buffer, text)?;
        }
        self.tmux.paste_buffer(run_id, &buffer).map_err(|detail| {
            PromptDeliveryError::new(PromptDeliveryFailureReason::PasteFailed, detail)
        })?;
        self.wait_until_visible(contract, run_id, text, baseline)
    }

    fn load_large_buffer(
        &mut self,
        run_id: &str,
        buffer: &str,
        text: &str,
    ) -> Result<(), PromptDeliveryError> {
        let mut file = tempfile::NamedTempFile::new().map_err(|error| {
            PromptDeliveryError::new(
                PromptDeliveryFailureReason::BufferCreationFailed,
                error.to_string(),
            )
        })?;
        file.write_all(text.as_bytes()).map_err(|error| {
            PromptDeliveryError::new(
                PromptDeliveryFailureReason::BufferCreationFailed,
                error.to_string(),
            )
        })?;
        file.flush().map_err(|error| {
            PromptDeliveryError::new(
                PromptDeliveryFailureReason::BufferCreationFailed,
                error.to_string(),
            )
        })?;
        self.tmux
            .load_buffer(run_id, buffer, file.path())
            .map_err(|detail| {
                PromptDeliveryError::new(PromptDeliveryFailureReason::BufferCreationFailed, detail)
            })
    }

    fn wait_until_visible(
        &mut self,
        contract: ProviderContract,
        run_id: &str,
        text: &str,
        baseline: &[u8],
    ) -> Result<(), PromptDeliveryError> {
        let evidence = PasteEvidence::before(contract, text, baseline);
        let deadline = Instant::now() + self.timings.visibility_timeout;
        loop {
            let screen = self.tmux.capture_screen(run_id).map_err(|detail| {
                PromptDeliveryError::new(PromptDeliveryFailureReason::CaptureFailed, detail)
            })?;
            if Instant::now() >= deadline {
                return Err(PromptDeliveryError::new(
                    PromptDeliveryFailureReason::VisibilityTimeout,
                    "pasted text did not become visible before the deadline",
                ));
            }
            if evidence.is_visible(&screen) {
                return Ok(());
            }
            thread::sleep(self.timings.visibility_poll);
        }
    }
}

pub fn stage_text(provider: Provider, run_id: &str, text: &str) -> Result<(), PromptDeliveryError> {
    PromptDelivery::new(TmuxPromptDelivery::discover()?).stage(provider, run_id, text)
}

pub fn submit_text(
    provider: Provider,
    run_id: &str,
    text: &str,
) -> Result<(), PromptDeliveryError> {
    PromptDelivery::new(TmuxPromptDelivery::discover()?).submit(provider, run_id, text)
}

pub fn entry_skill_invocation(provider: Provider, skill: &str) -> String {
    format!("{}{skill}", provider_contract(provider).invocation_prefix)
}

#[cfg(test)]
mod tests;
