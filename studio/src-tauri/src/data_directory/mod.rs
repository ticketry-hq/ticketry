//! Exclusive ownership of the backend's established data directory.
//!
//! The guard intentionally owns no child process.  The lifecycle supervisor
//! must acquire it before spawning a backend, and release it after reaping the
//! children it owns.  A kernel advisory lock is the source of truth: metadata
//! makes a conflicting owner actionable, while the lock is automatically
//! released when a process is forcibly quit.

pub mod advisory_lock;
pub mod development_mode;
pub mod error;
pub mod guard;
pub mod location;
pub mod owner_record;

pub use development_mode::{DevelopmentMode, DEVELOPMENT_BACKEND_PORT};
pub use error::OwnershipError;
pub use guard::{DataDirectoryAccess, DataDirectoryGuard};
pub use location::established_data_directory;
pub use owner_record::OwnerIdentity;

#[cfg(test)]
mod tests;
