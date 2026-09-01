//! The disposable `--temp-sqlite` profile and its journaled teardown.
//!
//! Temporary mode deliberately gives up its terminals along with its database.
//! That is still an effect on a live tmux server, so it goes through the same
//! cause-bound cleanup journal every other terminal teardown uses: the journal
//! is written and read back before the database that holds it is destroyed.

mod disposal;
mod journal;
mod profile;

pub use disposal::ProfileRemoval;
pub use journal::{
    journal_profile_teardown, journal_terminal_cleanup, ProfileTeardownOutcome,
    TemporaryProfileTeardown, UnresolvedCleanup,
};
pub use profile::{TemporarySqliteProfile, TEMP_SQLITE_FLAG};
