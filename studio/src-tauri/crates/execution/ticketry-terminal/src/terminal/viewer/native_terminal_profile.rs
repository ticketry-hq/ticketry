//! The terminal protocol and terminfo database that a native libghostty
//! viewer's tmux attach client should advertise.
//!
//! CODING-1486 — native libghostty draws the terminal itself, so programs
//! running inside it should be told they are talking to Ghostty and should
//! read Ticketry's pinned `xterm-ghostty` terminfo entry. The streamed viewer
//! is a different case: there the emulator is xterm.js in the WebView, so it
//! keeps advertising `xterm-256color` against the system database.
//!
//! The pinned entry is resolved from the running executable rather than from
//! the process environment, so it does not depend on the AppKit bridge having
//! already run `configure_bundled_ghostty_environment`. If the entry is not
//! found — an unsupported platform, or a build whose resources were not staged
//! — the profile degrades to the system database instead of advertising a
//! terminfo entry that nothing can read.

use std::path::{Path, PathBuf};

const GHOSTTY_TERM: &str = "xterm-ghostty";
const SYSTEM_TERM: &str = "xterm-256color";
#[cfg(target_os = "macos")]
const SYSTEM_TERMINFO: &str = "/usr/share/terminfo";

/// The terminfo entry every pinned Ghostty database is expected to contain.
const GHOSTTY_TERMINFO_SENTINEL: &str = "78/xterm-ghostty";

/// What a native viewer's attach client should be told about its terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NativeTerminalProfile {
    pub(super) term: String,
    pub(super) terminfo: Option<PathBuf>,
}

impl NativeTerminalProfile {
    /// The profile for the running executable.
    pub(super) fn resolve() -> Self {
        let executable = std::env::current_exe().ok();
        Self::for_executable(executable.as_deref(), |path| path.exists())
    }

    /// The resolution rule, with the executable location and the existence
    /// check supplied so it can be exercised without a staged bundle.
    pub(super) fn for_executable(
        executable: Option<&Path>,
        exists: impl Fn(&Path) -> bool,
    ) -> Self {
        if let Some(terminfo) = pinned_terminfo(executable, exists) {
            return Self {
                term: GHOSTTY_TERM.to_owned(),
                terminfo: Some(terminfo),
            };
        }
        Self {
            term: SYSTEM_TERM.to_owned(),
            #[cfg(target_os = "macos")]
            terminfo: Some(PathBuf::from(SYSTEM_TERMINFO)),
            #[cfg(not(target_os = "macos"))]
            terminfo: None,
        }
    }
}

/// Ticketry's pinned terminfo database, if this build actually carries it.
///
/// `NSBundle.mainBundle` resolves to `Contents/Resources` for a packaged
/// `.app` and to the executable's own directory for an unbundled binary, so
/// both layouts are checked in that order.
fn pinned_terminfo(executable: Option<&Path>, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let directory = executable?.parent()?;
    let candidates = [
        directory.join("../Resources/terminfo"),
        directory.join("terminfo"),
    ];
    candidates
        .into_iter()
        .find(|candidate| exists(&candidate.join(GHOSTTY_TERMINFO_SENTINEL)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_packaged_bundle_resources_database() {
        let profile = NativeTerminalProfile::for_executable(
            Some(Path::new(
                "/Applications/Ticketry.app/Contents/MacOS/ticketry",
            )),
            |path| {
                path == Path::new(
                    "/Applications/Ticketry.app/Contents/MacOS/../Resources/terminfo/78/xterm-ghostty",
                )
            },
        );

        assert_eq!(profile.term, GHOSTTY_TERM);
        assert_eq!(
            profile.terminfo,
            Some(PathBuf::from(
                "/Applications/Ticketry.app/Contents/MacOS/../Resources/terminfo"
            )),
        );
    }

    #[test]
    fn accepts_resources_staged_beside_an_unbundled_executable() {
        let profile = NativeTerminalProfile::for_executable(
            Some(Path::new("/build/target/debug/ticketry")),
            |path| path == Path::new("/build/target/debug/terminfo/78/xterm-ghostty"),
        );

        assert_eq!(profile.term, GHOSTTY_TERM);
        assert_eq!(
            profile.terminfo,
            Some(PathBuf::from("/build/target/debug/terminfo")),
        );
    }

    #[test]
    fn degrades_to_the_system_database_without_a_pinned_entry() {
        let profile = NativeTerminalProfile::for_executable(
            Some(Path::new("/build/target/debug/ticketry")),
            |_| false,
        );

        assert_eq!(profile.term, SYSTEM_TERM);
        #[cfg(target_os = "macos")]
        assert_eq!(profile.terminfo, Some(PathBuf::from(SYSTEM_TERMINFO)));
        #[cfg(not(target_os = "macos"))]
        assert_eq!(profile.terminfo, None);
    }

    #[test]
    fn degrades_when_the_executable_cannot_be_located() {
        let profile = NativeTerminalProfile::for_executable(None, |_| true);

        assert_eq!(profile.term, SYSTEM_TERM);
    }
}
