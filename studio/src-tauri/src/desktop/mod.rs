//! The Tauri desktop shell: process ownership, supervised backend services,
//! and the small contract Studio's webview is allowed to see.
//!
//! Nothing here knows about work-item domain logic. It owns the data
//! directory, launches and watches the packaged sidecar pair, and publishes
//! service health plus user notices to the frontend.

pub(crate) mod backend_launch;
pub(crate) mod commands;
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
mod run;
pub(crate) mod runs_handoff;
pub(crate) mod runtime_configuration;
pub(crate) mod service_health;
pub(crate) mod service_state;
pub(crate) mod sidecar_probe;
pub(crate) mod startup;
pub(crate) mod supervisor_monitor;
pub(crate) mod user_notices;
pub(crate) mod webview_origin;
pub(crate) mod workspace_handoff;

pub use run::run;
