//! Whether the paths an installation records are ones Ticketry may act on.
//!
//! Adoption preserves paths verbatim, so a path that escapes its authority in
//! the source escapes it in the adopted installation too — and then Ticketry
//! reads, writes, or deletes through it as if it were its own. The checks here
//! decide that question as data plus a bounded look at the filesystem, and they
//! never create, move, or open anything.
//!
//! Two authorities are enforced. A relative path recorded against a root must
//! stay inside that root: no absolute escape, no `..`, no root-anchored
//! traversal. A directory the data directory owns must be a real directory, not
//! a link out of it — proven by walking the path one component at a time and
//! refusing at the first symlink whose target leaves the allowed root, rather
//! than resolving the whole path and inspecting where it landed.

use std::path::{Component, Path};

/// Why one recorded path is not one Ticketry may act on.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PathDefect {
    /// The path is empty, or holds a byte a path cannot carry.
    Malformed,
    /// A relative path was expected and an absolute one was recorded.
    UnexpectedlyAbsolute,
    /// An absolute path was expected and a relative one was recorded.
    UnexpectedlyRelative,
    /// The path leaves its root through `..` or a root anchor.
    EscapesRoot,
    /// A component of the path is a symlink pointing outside the allowed root.
    SymlinkEscapesRoot,
    /// The path exists but is not the kind of entry Ticketry keeps there.
    WrongKind,
}

impl PathDefect {
    /// The stable rule name this defect is reported under.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Malformed => "path-malformed",
            Self::UnexpectedlyAbsolute => "path-unexpectedly-absolute",
            Self::UnexpectedlyRelative => "path-unexpectedly-relative",
            Self::EscapesRoot => "path-escapes-its-root",
            Self::SymlinkEscapesRoot => "path-symlink-escapes-allowed-root",
            Self::WrongKind => "path-wrong-kind",
        }
    }

    /// The rule in one operator-safe sentence.
    #[must_use]
    pub const fn rule(self) -> &'static str {
        match self {
            Self::Malformed => "every recorded path is a usable path",
            Self::UnexpectedlyAbsolute => {
                "a path recorded relative to a root is not an absolute path"
            }
            Self::UnexpectedlyRelative => "a recorded external root is an absolute path",
            Self::EscapesRoot => "a path recorded against a root stays inside that root",
            Self::SymlinkEscapesRoot => {
                "no component of an owned path is a link outside its allowed root"
            }
            Self::WrongKind => "an owned path holds the kind of entry Ticketry keeps there",
        }
    }
}

/// Check a path recorded as relative to a root it must not leave.
///
/// The root itself is not consulted on disk: what is decided here is whether
/// the recorded value can name anything outside it at all. That keeps the rule
/// meaningful for a root that has since been removed or moved.
#[must_use]
pub(crate) fn contained_relative(recorded: &str) -> Option<PathDefect> {
    if let Some(defect) = malformed(recorded) {
        return Some(defect);
    }
    let path = Path::new(recorded);
    if path.is_absolute() {
        return Some(PathDefect::UnexpectedlyAbsolute);
    }
    path.components()
        .any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        .then_some(PathDefect::EscapesRoot)
}

/// Check a path recorded as an external absolute root.
///
/// Ticketry does not choose these: a repository root, a checkout, a design
/// directory, and a launch working directory are wherever the user's work
/// lives. So the rule is about the recorded value's authority — absolute and
/// traversal-free — and not about where on the machine it points.
#[must_use]
pub(crate) fn external_root(recorded: &str) -> Option<PathDefect> {
    if let Some(defect) = malformed(recorded) {
        return Some(defect);
    }
    let path = Path::new(recorded);
    if !path.is_absolute() {
        return Some(PathDefect::UnexpectedlyRelative);
    }
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
        .then_some(PathDefect::EscapesRoot)
}

/// What kind of entry an owned path holds when it exists.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Owned {
    /// A directory Ticketry reads or writes inside.
    Directory,
    /// A single configuration or log file.
    File,
}

/// Check a path the data directory owns, without following a link out of it.
///
/// `candidate` must be inside `allowed`, and every component of it that exists
/// must reach its target without a symlink whose destination leaves `allowed`.
/// A component that does not exist yet is not a defect: an installation that
/// has never launched a provider has no spool, and a data directory with no
/// attachments has no media root.
#[must_use]
pub(crate) fn owned_path(allowed: &Path, candidate: &Path, expected: Owned) -> Option<PathDefect> {
    let Ok(boundary) = allowed.canonicalize() else {
        // An unreadable allowed root is not this rule's finding: the read view
        // proved the installation itself is readable, and every other path rule
        // still applies. Reporting it here would name the same problem twice.
        return None;
    };
    let Ok(relative) = candidate.strip_prefix(allowed) else {
        return Some(PathDefect::EscapesRoot);
    };
    if relative
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Some(PathDefect::EscapesRoot);
    }

    // The walk starts at the resolved boundary, not at the filesystem root: the
    // allowed root is where authority begins, and its own ancestors are the
    // machine's business. On macOS they are also symlinked — the temporary
    // directory every data directory in a test lives under is reached through
    // one — so walking above the boundary would refuse every installation.
    let mut walked = boundary.clone();
    for component in relative.components() {
        walked.push(component);
        let Ok(metadata) = std::fs::symlink_metadata(&walked) else {
            // The rest of the path does not exist yet. Nothing can be escaping
            // through a component that is not there.
            return None;
        };
        if metadata.file_type().is_symlink() {
            // Resolve exactly this component and stop. Following further would
            // be walking a path that has already left the boundary.
            let Ok(target) = walked.canonicalize() else {
                return Some(PathDefect::SymlinkEscapesRoot);
            };
            if !target.starts_with(&boundary) {
                return Some(PathDefect::SymlinkEscapesRoot);
            }
        }
    }
    // Every link on the way here was proven to stay inside the boundary, so the
    // kind of entry is asked of the target rather than of the last link.
    match std::fs::metadata(&walked) {
        Ok(metadata) if metadata.is_dir() != (expected == Owned::Directory) => {
            Some(PathDefect::WrongKind)
        }
        _ => None,
    }
}

fn malformed(recorded: &str) -> Option<PathDefect> {
    (recorded.trim().is_empty() || recorded.contains('\0')).then_some(PathDefect::Malformed)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{contained_relative, external_root, owned_path, Owned, PathDefect};

    #[test]
    fn a_relative_path_may_not_leave_its_root() {
        assert_eq!(contained_relative("module/SPEC.md"), None);
        assert_eq!(
            contained_relative("../../etc/passwd"),
            Some(PathDefect::EscapesRoot)
        );
        assert_eq!(
            contained_relative("nested/../../outside"),
            Some(PathDefect::EscapesRoot)
        );
        assert_eq!(
            contained_relative("/etc/passwd"),
            Some(PathDefect::UnexpectedlyAbsolute)
        );
        assert_eq!(contained_relative("  "), Some(PathDefect::Malformed));
    }

    #[test]
    fn a_nested_relative_path_that_returns_inside_is_still_refused() {
        // `a/../a/file` resolves inside the root, but accepting it would mean
        // accepting `..` in recorded paths, and the next one may not return.
        assert_eq!(
            contained_relative("a/../a/file"),
            Some(PathDefect::EscapesRoot)
        );
    }

    #[test]
    fn an_external_root_must_be_absolute_and_traversal_free() {
        assert_eq!(external_root("/Users/someone/code/app"), None);
        assert_eq!(
            external_root("relative/checkout"),
            Some(PathDefect::UnexpectedlyRelative)
        );
        assert_eq!(
            external_root("/Users/someone/../../etc"),
            Some(PathDefect::EscapesRoot)
        );
    }

    #[test]
    fn an_owned_directory_may_not_be_a_link_out_of_the_data_directory() {
        let data = tempfile::tempdir().expect("a data directory");
        let outside = tempfile::tempdir().expect("a directory outside it");
        let media = data.path().join("media");

        // Absent is fine: nothing has been stored yet.
        assert_eq!(owned_path(data.path(), &media, Owned::Directory), None);

        std::fs::create_dir(&media).expect("create the media root");
        assert_eq!(owned_path(data.path(), &media, Owned::Directory), None);

        std::fs::remove_dir(&media).expect("replace the media root");
        std::os::unix::fs::symlink(outside.path(), &media).expect("link the media root out");
        assert_eq!(
            owned_path(data.path(), &media, Owned::Directory),
            Some(PathDefect::SymlinkEscapesRoot)
        );
    }

    #[test]
    fn an_owned_directory_is_refused_through_a_linked_ancestor() {
        let data = tempfile::tempdir().expect("a data directory");
        let outside = tempfile::tempdir().expect("a directory outside it");
        std::fs::create_dir(outside.path().join("hooks")).expect("create the escaped child");
        std::os::unix::fs::symlink(outside.path(), data.path().join("runtime"))
            .expect("link an ancestor out");

        assert_eq!(
            owned_path(
                data.path(),
                &data.path().join("runtime/hooks"),
                Owned::Directory
            ),
            Some(PathDefect::SymlinkEscapesRoot)
        );
    }

    #[test]
    fn a_link_that_stays_inside_the_data_directory_is_allowed() {
        let data = tempfile::tempdir().expect("a data directory");
        std::fs::create_dir(data.path().join("real")).expect("create the real directory");
        std::os::unix::fs::symlink(data.path().join("real"), data.path().join("media"))
            .expect("link inside the boundary");

        assert_eq!(
            owned_path(data.path(), &data.path().join("media"), Owned::Directory),
            None
        );
    }

    #[test]
    fn a_file_where_a_directory_belongs_is_a_defect() {
        let data = tempfile::tempdir().expect("a data directory");
        std::fs::write(data.path().join("media"), b"not a directory").expect("stage a file");

        assert_eq!(
            owned_path(data.path(), &data.path().join("media"), Owned::Directory),
            Some(PathDefect::WrongKind)
        );
    }

    #[test]
    fn a_candidate_outside_the_allowed_root_is_refused_outright() {
        let data = tempfile::tempdir().expect("a data directory");
        assert_eq!(
            owned_path(data.path(), Path::new("/etc"), Owned::Directory),
            Some(PathDefect::EscapesRoot)
        );
    }
}
