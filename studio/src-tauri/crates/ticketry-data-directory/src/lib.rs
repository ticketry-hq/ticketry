#![deny(private_bounds, private_interfaces)]

//! Exclusive ownership of Ticketry's established data directory.
//!
//! The desktop acquires the guard before opening the database and releases it
//! after its in-process tasks settle. A kernel advisory lock is the source of truth: metadata
//! makes a conflicting owner actionable, while the lock is automatically
//! released when a process is forcibly quit.

mod advisory_lock;
mod error;
mod guard;
mod location;
mod owner_record;

// Keep the implementation modules private. These are the complete supported
// cross-crate ownership seams; callers should not depend on storage, lock, or
// path-resolution module names.
pub use error::OwnershipError;
pub use guard::{live_lease_owner, DataDirectoryGuard};
pub use location::established_data_directory;
pub use owner_record::OwnerIdentity;

#[cfg(test)]
mod tests;
