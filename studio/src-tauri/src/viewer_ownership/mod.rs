//! Durable ownership for transient terminal viewers.
//!
//! Viewer mechanics must attach and validate before they are staged here.
//! Durable authority then changes under the Agent Run lock, and only after the
//! transaction commits does the service detach a displaced process-local
//! viewer. None of these operations can terminate the hosted tmux session.

mod error;
mod expiry;
mod graphql;
mod service;

pub use error::{ViewerOwnershipError, ViewerOwnershipErrorCode};
pub use service::{
    CreateViewerLease, DeleteViewerLease, PreparedViewerMechanics, UpdateViewerLease,
    ViewerDetachReason, ViewerOwnershipService,
};

pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    graphql::register(builder)
}
