use super::{PromptDeliveryError, PromptDeliveryFailureReason};
use crate::tmux_adapter::TmuxAdapter;
use std::path::Path;

pub trait PromptDeliveryTmux {
    fn verify_session(&mut self, run_id: &str) -> Result<(), String>;
    fn capture_screen(&mut self, run_id: &str) -> Result<Vec<u8>, String>;
    fn set_buffer(&mut self, run_id: &str, buffer: &str, text: &str) -> Result<(), String>;
    fn load_buffer(&mut self, run_id: &str, buffer: &str, path: &Path) -> Result<(), String>;
    fn paste_buffer(&mut self, run_id: &str, buffer: &str) -> Result<(), String>;
    fn send_enter(&mut self, run_id: &str) -> Result<(), String>;
}

pub struct TmuxPromptDelivery {
    adapter: TmuxAdapter,
}

impl TmuxPromptDelivery {
    pub fn discover() -> Result<Self, PromptDeliveryError> {
        TmuxAdapter::discover()
            .map(|adapter| Self { adapter })
            .map_err(|error| {
                PromptDeliveryError::new(
                    PromptDeliveryFailureReason::CaptureFailed,
                    error.to_string(),
                )
            })
    }
}

impl PromptDeliveryTmux for TmuxPromptDelivery {
    fn verify_session(&mut self, run_id: &str) -> Result<(), String> {
        self.adapter
            .verify_prompt_session(run_id)
            .map_err(|error| error.to_string())
    }

    fn capture_screen(&mut self, run_id: &str) -> Result<Vec<u8>, String> {
        self.adapter
            .capture_screen(run_id)
            .map_err(|error| error.to_string())
    }

    fn set_buffer(&mut self, run_id: &str, buffer: &str, text: &str) -> Result<(), String> {
        self.adapter
            .set_prompt_buffer(run_id, buffer, text)
            .map_err(|error| error.to_string())
    }

    fn load_buffer(&mut self, run_id: &str, buffer: &str, path: &Path) -> Result<(), String> {
        self.adapter
            .load_prompt_buffer(run_id, buffer, path)
            .map_err(|error| error.to_string())
    }

    fn paste_buffer(&mut self, run_id: &str, buffer: &str) -> Result<(), String> {
        self.adapter
            .paste_prompt_buffer(run_id, buffer)
            .map_err(|error| error.to_string())
    }

    fn send_enter(&mut self, run_id: &str) -> Result<(), String> {
        self.adapter
            .send_prompt_enter(run_id)
            .map_err(|error| error.to_string())
    }
}
