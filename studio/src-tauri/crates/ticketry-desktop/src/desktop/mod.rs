//! The Tauri desktop shell: process ownership and in-process Rust services,
//! and the small contract Studio's webview is allowed to see.
//!
//! Nothing here knows about work-item domain logic. It owns the data
//! directory, starts process-local tasks, and publishes
//! service health plus user notices to the frontend.

pub mod commands;
pub mod crash_reports;
pub mod data_directory;
pub mod document_protocol;
pub mod environment;
pub mod folder_selection;
pub mod frontend_log;
pub mod launch_runtime;
pub mod lifecycle;
pub mod mcp_runtime;
pub mod packaged_binaries;
pub mod readiness_publication;
mod run;
pub mod runs_handoff;
pub mod runtime_configuration;
pub mod rust_runtime_launch;
pub mod service_health;
pub mod service_state;
pub mod startup;
pub mod user_notices;
pub mod workspace_handoff;

pub use run::run;
