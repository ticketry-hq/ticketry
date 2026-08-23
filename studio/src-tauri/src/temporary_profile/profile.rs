//! The private, process-owned profile behind `--temp-sqlite`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::disposal::{self, ProfileRemoval};
use super::journal::{self, ProfileTeardownOutcome};

pub const TEMP_SQLITE_FLAG: &str = "--temp-sqlite";
pub(super) const TEMP_SQLITE_PREFIX: &str = "ticketry-temp-sqlite-";

pub struct TemporarySqliteProfile {
    path: PathBuf,
    temporary_root: PathBuf,
    tmux_socket: String,
}

impl TemporarySqliteProfile {
    pub fn create() -> io::Result<Self> {
        let temporary_root = fs::canonicalize(std::env::temp_dir())?;
        for _ in 0..32 {
            let identity = format!("{}-{:016x}", std::process::id(), rand::random::<u64>());
            let candidate = temporary_root.join(format!("{TEMP_SQLITE_PREFIX}{identity}"));
            match fs::create_dir(&candidate) {
                Ok(()) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o700))?;
                    }
                    return Ok(Self {
                        path: candidate,
                        temporary_root,
                        tmux_socket: format!("ticketry-temp-{identity}"),
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique temporary Ticketry profile",
        ))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn activate(&self) {
        std::env::set_var("MUXED_DATA_DIR", &self.path);
        std::env::set_var("MUXED_FORCE_SQLITE", "true");
        std::env::set_var("MUXED_TMUX_SOCKET", &self.tmux_socket);
    }

    /// Whether the tmux server this process would reach is still the profile's
    /// own socket. Whole-socket cleanup is only ever this profile's to perform.
    fn owns_the_active_tmux_socket(&self) -> bool {
        std::env::var("MUXED_TMUX_SOCKET").is_ok_and(|socket| socket == self.tmux_socket)
    }
}

impl Drop for TemporarySqliteProfile {
    fn drop(&mut self) {
        if !disposal::is_temporary_profile(&self.path, &self.temporary_root) {
            eprintln!(
                "Ticketry refused to remove unexpected temporary profile {}",
                self.path.display()
            );
            return;
        }

        // Temporary mode deliberately gives up its verified sessions with the
        // database, but it records that decision first. Every terminal the
        // profile still holds is torn down through its predetermined cleanup
        // effect, so an unconfirmed kill survives as retryable durable
        // evidence instead of dying with the database it was written to.
        let outcome = journal::journal_profile_teardown(&self.path);
        report_teardown(&outcome, &self.path);
        if !outcome.is_complete() {
            eprintln!(
                "Ticketry kept the temporary SQLite profile {} so its unresolved terminal cleanup journal survives",
                self.path.display()
            );
            return;
        }

        // The journal has proved every recorded terminal absent. A temporary
        // socket can still hold a verified session no row ever named, from a
        // launch that died before it could be recorded; temporary mode gives
        // those up with the profile and reports the outcome rather than
        // discarding it. A socket this profile no longer owns is never swept.
        if self.owns_the_active_tmux_socket() {
            if let Err(error) = crate::tmux_adapter::TmuxAdapter::discover()
                .and_then(|adapter| adapter.kill_all_verified())
            {
                eprintln!("Ticketry could not sweep unrecorded temporary sessions: {error}");
            }
        }

        match disposal::remove(&self.path) {
            ProfileRemoval::Removed => {
                eprintln!("Removed temporary SQLite profile: {}", self.path.display())
            }
            ProfileRemoval::Failed(error) => eprintln!(
                "Ticketry could not remove temporary SQLite profile {}: {error}",
                self.path.display()
            ),
        }
    }
}

fn report_teardown(outcome: &ProfileTeardownOutcome, path: &Path) {
    match outcome {
        ProfileTeardownOutcome::NoTerminalHistory => {}
        ProfileTeardownOutcome::Journaled(teardown) => {
            eprintln!(
                "Journaled temporary-profile cleanup for {} terminal(s) in {}",
                teardown.journaled,
                path.display()
            );
            for unresolved in &teardown.unresolved {
                eprintln!(
                    "  unresolved cleanup effect {} for Agent Run {} is {}{}",
                    unresolved.effect_id,
                    unresolved.agent_run_id,
                    unresolved.state,
                    unresolved
                        .last_error_code
                        .as_ref()
                        .map(|code| format!(" ({code})"))
                        .unwrap_or_default(),
                );
            }
        }
        ProfileTeardownOutcome::Unavailable(reason) => {
            eprintln!("Ticketry could not journal temporary-profile cleanup: {reason}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporary_sqlite_profile_is_private_and_removed_when_dropped() {
        let profile = TemporarySqliteProfile::create().expect("create temporary profile");
        let path = profile.path().to_owned();

        assert!(path.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path)
                    .expect("profile metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }

        drop(profile);
        assert!(!path.exists());
    }
}
