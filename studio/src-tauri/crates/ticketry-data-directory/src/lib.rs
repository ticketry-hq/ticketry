//! Exclusive ownership of Ticketry's established data directory.
//!
//! The desktop acquires the guard before opening the database and releases it
//! after its in-process tasks settle. A kernel advisory lock is the source of truth: metadata
//! makes a conflicting owner actionable, while the lock is automatically
//! released when a process is forcibly quit.

pub mod advisory_lock;
pub mod error;
pub mod guard;
pub mod location;
pub mod owner_record;

pub use error::OwnershipError;
pub use guard::{live_lease_owner, DataDirectoryGuard};
pub use location::established_data_directory;
pub use owner_record::OwnerIdentity;

#[cfg(test)]
mod tests;
