//! Durable, verified cleanup for one Terminal Session.
//!
//! Every caller commits a cause-bound effect before inspecting tmux. Runtime
//! absence is success, and only verified Ticketry ownership permits a kill.

mod checkpoint;
mod effect;
mod error;
mod graphql;
mod journal;
mod runtime;
mod service;

pub use checkpoint::{CleanupCheckpoint, CleanupCheckpoints};
pub use effect::{CleanupCause, CleanupEffectIdentity};
pub use error::{TerminalCleanupError, TerminalCleanupErrorCode};
pub use runtime::{
    CleanupKillResult, CleanupRuntimeObservation, RuntimeInventory, TerminalCleanupRuntime,
    TmuxCleanupRuntime,
};
pub use service::{
    AuthenticatedAgentRun, TerminalCleanupRecoveryReport, TerminalCleanupService, TerminationPatch,
    DEFAULT_OWNED_ORPHAN_GRACE_SECONDS,
};

pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}
