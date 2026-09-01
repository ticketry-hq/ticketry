//! The Tauri desktop shell: process ownership and in-process Rust services,
//! and the small contract Studio's webview is allowed to see.
//!
//! Nothing here knows about work-item domain logic. It owns the data
//! directory, starts process-local tasks, and publishes
//! service health plus user notices to the frontend.

pub(crate) mod commands;
pub(crate) mod crash_reports;
pub(crate) mod data_directory;
pub(crate) mod document_protocol;
pub(crate) mod environment;
pub(crate) mod folder_selection;
pub(crate) mod frontend_log;
pub(crate) mod launch_runtime;
pub(crate) mod lifecycle;
pub(crate) mod mcp_runtime;
pub(crate) mod packaged_binaries;
pub(crate) mod readiness_publication;
pub(crate) mod run;
pub(crate) mod runs_handoff;
pub(crate) mod runtime_configuration;
pub(crate) mod rust_runtime_launch;
pub(crate) mod service_health;
pub(crate) mod service_state;
pub(crate) mod startup;
pub(crate) mod user_notices;
pub(crate) mod workspace_handoff;

pub use run::run;
