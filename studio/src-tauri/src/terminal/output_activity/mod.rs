//! Durable observation of changed terminal output.
//!
//! Callers submit one Terminal Session identity. This capability binds the
//! live runtime, captures the rendered tmux pane, deduplicates its compact
//! identity, and commits the activity fields with the Run status fact.

mod capture;
mod error;
mod service;
mod sweep;

pub use capture::TerminalScreenCapture;
pub use error::{TerminalOutputActivityError, TerminalOutputActivityErrorCode};
pub use service::{TerminalOutputActivityService, TerminalOutputObservation};
pub use sweep::{
    configured_sweep_interval, observe_live_sessions, LiveOutputSweepRuntime,
    DEFAULT_SWEEP_INTERVAL, OUTPUT_SWEEP_INTERVAL_ENV,
};
