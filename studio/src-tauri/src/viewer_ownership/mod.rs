//! Durable ownership for transient terminal viewers.
//!
//! Viewer mechanics must attach and validate before they are staged here.
//! Durable authority then changes under the Agent Run lock, and only after the
//! transaction commits does the service detach a displaced process-local
//! viewer. None of these operations can terminate the hosted tmux session.

mod error;
mod expiry;
mod service;
mod write_model;

pub use error::{ViewerOwnershipError, ViewerOwnershipErrorCode};
pub use service::{
    CreateViewerLease, DeleteViewerLease, PreparedViewerMechanics, UpdateViewerLease,
    ViewerDetachReason, ViewerOwnershipService,
};
pub(crate) use write_model::{
    PreparedViewerLeaseWrite, ViewerLeaseModelWrite, ViewerLeaseWritePermit,
};
