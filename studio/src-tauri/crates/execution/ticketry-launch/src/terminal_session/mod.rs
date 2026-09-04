//! The caller-owned contract for creating one Terminal Session.
//!
//! Launch authority resolves these requests and the terminal slice executes
//! them, so the request shape, its validation, and its error codes belong to
//! neither side alone. They live here, below both.

mod error;
mod request;

pub use error::{TerminalLaunchError, TerminalLaunchErrorCode};
pub use request::{CreateTerminalSession, TerminalLaunchKind};
