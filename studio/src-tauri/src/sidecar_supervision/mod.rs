//! The desktop-owned lifecycle for packaged sidecars.
//!
//! This module deliberately has no "run a command" API.  A caller can only
//! construct the application-owned backend command table in
//! [`command_table`], and the supervisor only reaps sidecars whose
//! [`OwnedSidecar`](crate::sidecar_supervision::owned_sidecar::OwnedSidecar) handles it created.

pub mod captured_logs;
pub mod command_table;
pub mod control_protocol;
pub mod error;
pub mod events;
pub mod health_probe;
pub mod launch;
pub mod log_redaction;
pub mod log_rotation;
pub mod loopback_port;
pub mod mcp_port;
pub mod options;
pub mod owned_sidecar;
pub mod reaping;
pub mod recovery;
pub mod release_manifest;
pub mod supervisor;
pub mod teardown;

pub use command_table::CommandTable;
pub use error::{FailureKind, SupervisorError};
pub use events::SupervisorEvent;
pub use log_rotation::sidecar_log_path;
pub use options::SupervisorOptions;
pub use supervisor::Supervisor;

#[cfg(test)]
mod tests;
