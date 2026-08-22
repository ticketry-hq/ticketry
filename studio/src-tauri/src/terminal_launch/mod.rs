//! Restricted creation of one Terminal Session.
//!
//! A client request identity predetermines the Agent Run and Launch Effect.
//! Preparation commits those rows, the initial Runs fact, and normalized
//! launch material before the runtime port can be called. Execution probes
//! first, creates only after proved absence, verifies again, then commits the
//! authoritative Terminal Session with the effect and running fact.

mod checkpoint;
mod error;
mod execution;
mod graphql;
pub(crate) mod login_shell;
mod material;
mod request;
mod runtime;
mod service;
mod settlement;

pub use checkpoint::{TerminalLaunchBoundary, TerminalLaunchCheckpoint};
pub use error::{TerminalLaunchError, TerminalLaunchErrorCode};
pub use execution::TerminalLaunchRecoveryReport;
pub use request::{CreateTerminalSession, TerminalLaunchKind};
pub use runtime::{TerminalLaunchRuntime, TerminalRuntimeObservation, VerifiedTerminalRuntime};
pub use service::TerminalLaunchService;

pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}
