//! How much of the installation a launch re-verifies.
//!
//! A store Rust already owns was fully preflighted when it was adopted, and
//! every Rust write since has enforced the same rules at write time. Repeating
//! SQLite's whole-file integrity check and the semantic rule list on every
//! launch cost more than the rest of startup combined and could only find bugs
//! in Ticketry's own writers, so a plain reopen skips them by default. The full
//! preflight stays one flag away for support and for verifying after an update.

use std::env;

/// Command-line flag that forces the full preflight on a Rust-owned store.
pub const VERIFY_STORE_FLAG: &str = "--verify-store";

/// Environment variable equivalent of [`VERIFY_STORE_FLAG`], for scripts and
/// for the flag to reach the crate from the process entry point.
pub const VERIFY_STORE_ENV: &str = "TICKETRY_VERIFY_STORE";

/// Whether this process asked for the full preflight on reopen.
pub(crate) fn full_verification_requested() -> bool {
    env::var(VERIFY_STORE_ENV).as_deref() == Ok("1")
}
