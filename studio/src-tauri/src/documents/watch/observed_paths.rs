//! Turning raw watched paths into the document paths a settlement can use.
//!
//! Two rules survive from the Django watcher because they are what make the
//! stream usable rather than merely present:
//!
//! * **Only documents count.** Markdown and HTML, matched case-insensitively,
//!   at any depth. A generated image or stylesheet changing next to a document
//!   is not a registry change, so it must not become one.
//! * **A path is relative to its root.** The registry is keyed by
//!   `(root, relative path)`, and an absolute path from the operating system is
//!   evidence about a file, not an authority over where it may live. A path
//!   outside the root simply is not a path in this registry.
//!
//! Containment here is lexical, against the canonical root. Whether the file
//! *is* a file, and whether it still resolves inside the root after its
//! symlinks are followed, is proved again at settlement — a watcher event says
//! only "look here", never "this is servable".

use std::path::Path;

use crate::documents::document_scan::is_document_path;

/// The root-relative POSIX path of a supported document under `root`.
///
/// `None` for anything else: an unsupported extension, a path outside the root,
/// the root itself, or a name that is not valid UTF-8.
pub(super) fn document_rel_path(root: &Path, path: &Path) -> Option<String> {
    if !is_document_path(path) {
        return None;
    }
    // The event path and the root can disagree about symlinked ancestors
    // (`/tmp` against `/private/tmp` on macOS, for one), so both sides are
    // canonicalized as far as they exist before they are compared.
    let boundary = root.canonicalize().ok()?;
    let anchored = canonical_ancestor(path);
    let relative = anchored.strip_prefix(&boundary).ok()?;
    let mut posix = String::new();
    for component in relative.components() {
        let component = component.as_os_str().to_str()?;
        if !posix.is_empty() {
            posix.push('/');
        }
        posix.push_str(component);
    }
    (!posix.is_empty()).then_some(posix)
}

/// The path with its deepest existing ancestor canonicalized.
///
/// A removal event names a path that no longer exists, so it cannot be
/// canonicalized itself — but its directory usually can, which is enough to
/// compare it with the root.
fn canonical_ancestor(path: &Path) -> std::path::PathBuf {
    if let Ok(real) = path.canonicalize() {
        return real;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => canonical_ancestor(parent).join(name),
        _ => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_documents_are_relative_to_their_root_in_any_case() {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::create_dir_all(root.path().join("notes")).expect("create a subdirectory");

        assert_eq!(
            document_rel_path(root.path(), &root.path().join("SPEC.MD")),
            Some("SPEC.MD".to_owned())
        );
        assert_eq!(
            document_rel_path(root.path(), &root.path().join("notes/Design.HTML")),
            Some("notes/Design.HTML".to_owned())
        );
    }

    #[test]
    fn a_path_that_is_not_a_document_is_not_observed() {
        let root = tempfile::tempdir().expect("create a design directory");

        assert_eq!(
            document_rel_path(root.path(), &root.path().join("logo.png")),
            None
        );
        assert_eq!(
            document_rel_path(root.path(), &root.path().join("notes")),
            None
        );
    }

    #[test]
    fn a_document_outside_the_root_belongs_to_no_registry() {
        let root = tempfile::tempdir().expect("create a design directory");
        let outside = tempfile::tempdir().expect("create an outside directory");

        assert_eq!(
            document_rel_path(root.path(), &outside.path().join("secret.md")),
            None
        );
        assert_eq!(
            document_rel_path(root.path(), &root.path().join("../escape.md")),
            None
        );
    }

    #[test]
    fn a_removed_document_still_resolves_to_its_relative_path() {
        let root = tempfile::tempdir().expect("create a design directory");
        std::fs::create_dir_all(root.path().join("notes")).expect("create a subdirectory");

        // The file never existed, exactly as it will not exist when its
        // removal is observed.
        assert_eq!(
            document_rel_path(root.path(), &root.path().join("notes/gone.md")),
            Some("notes/gone.md".to_owned())
        );
    }
}
