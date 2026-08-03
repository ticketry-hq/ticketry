use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const TEMP_SQLITE_FLAG: &str = "--temp-sqlite";
const TEMP_SQLITE_PREFIX: &str = "ticketry-temp-sqlite-";

struct TemporarySqliteProfile {
    path: PathBuf,
    temporary_root: PathBuf,
    tmux_socket: String,
}

impl TemporarySqliteProfile {
    fn create() -> io::Result<Self> {
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

    fn activate(&self) {
        std::env::set_var("MUXED_DATA_DIR", &self.path);
        std::env::set_var("MUXED_FORCE_SQLITE", "true");
        std::env::set_var("MUXED_TMUX_SOCKET", &self.tmux_socket);
    }
}

impl Drop for TemporarySqliteProfile {
    fn drop(&mut self) {
        let safe_to_remove = self.path.parent() == Some(self.temporary_root.as_path())
            && self
                .path
                .file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|name| name.starts_with(TEMP_SQLITE_PREFIX));
        if !safe_to_remove {
            eprintln!(
                "Ticketry refused to remove unexpected temporary profile {}",
                self.path.display()
            );
            return;
        }

        // Temporary mode deliberately gives up durable agent sessions along
        // with its database. The socket name is unique to this launch.
        let _ = Command::new("tmux")
            .args(["-L", &self.tmux_socket, "kill-server"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        match fs::remove_dir_all(&self.path) {
            Ok(()) => eprintln!("Removed temporary SQLite profile: {}", self.path.display()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => eprintln!(
                "Ticketry could not remove temporary SQLite profile {}: {error}",
                self.path.display()
            ),
        }
    }
}

fn main() {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments
        .first()
        .is_some_and(|argument| argument == "--muxed-ghostty-bridge")
    {
        let Some(path) = arguments.get(1) else {
            eprintln!("missing native terminal bridge socket path");
            std::process::exit(2);
        };
        if let Err(error) =
            muxed_studio_lib::native_terminal::run_bridge(std::path::Path::new(&path))
        {
            eprintln!("native terminal bridge failed: {error}");
            std::process::exit(1);
        }
        return;
    }

    let temporary_profile = if arguments
        .iter()
        .any(|argument| argument == TEMP_SQLITE_FLAG)
    {
        match TemporarySqliteProfile::create() {
            Ok(profile) => {
                profile.activate();
                Some(profile)
            }
            Err(error) => {
                eprintln!("Ticketry could not create a temporary SQLite profile: {error}");
                std::process::exit(1);
            }
        }
    } else {
        None
    };
    muxed_studio_lib::run();
    drop(temporary_profile);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporary_sqlite_profile_is_private_and_removed_when_dropped() {
        let profile = TemporarySqliteProfile::create().expect("create temporary profile");
        let path = profile.path.clone();

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
