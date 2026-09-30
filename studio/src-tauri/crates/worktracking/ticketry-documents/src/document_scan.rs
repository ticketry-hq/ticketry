//! Recursive discovery of the supported documents inside one design directory.
//!
//! Discovery is filesystem-derived and deliberately narrow: only Markdown and
//! HTML are documents, the extension match is case-insensitive, nested
//! directories are included, and a file whose real location escapes the
//! directory boundary through a symlink is not a document at all.

use std::path::{Path, PathBuf};

/// The two extensions a registry row may describe, lowercase.
pub const DOCUMENT_EXTENSIONS: &[&str] = &["html", "md"];

/// Directory depth guard. A design directory is a small artifact folder; a
/// pathological tree must not turn one listing into an unbounded walk.
const MAX_DEPTH: usize = 32;

/// Whether a path names a supported document, ignoring case.
pub fn is_document_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .is_some_and(|extension| DOCUMENT_EXTENSIONS.contains(&extension.as_str()))
}

/// Every supported document inside `directory`, as sorted canonical relative
/// POSIX paths.
///
/// A missing or unreadable directory has no documents rather than being an
/// error: discovery describes what is on disk, and callers treat absence as
/// data.
pub fn scan_documents(directory: &Path) -> Vec<String> {
    let Ok(boundary) = directory.canonicalize() else {
        return Vec::new();
    };
    if !boundary.is_dir() {
        return Vec::new();
    }
    let mut found = Vec::new();
    walk(&boundary, &boundary, 0, &mut found);
    found.sort();
    found
}

fn walk(boundary: &Path, directory: &Path, depth: usize, found: &mut Vec<String>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // A symlink is never descended into: its contents belong to whatever
        // it points at rather than to this authorized root. It may still name
        // a document, but only if its real location stays inside the boundary.
        if file_type.is_dir() && !file_type.is_symlink() {
            walk(boundary, &path, depth + 1, found);
            continue;
        }
        if !is_document_path(&path) {
            continue;
        }
        if let Some(relative) = contained_relative_path(boundary, &path) {
            found.push(relative);
        }
    }
}

/// The boundary-relative POSIX path of a file whose real location is still
/// inside the boundary, or `None` when it escapes.
fn contained_relative_path(boundary: &Path, path: &Path) -> Option<String> {
    let real = path.canonicalize().ok()?;
    if !real.starts_with(boundary) {
        return None;
    }
    let relative: PathBuf = path.strip_prefix(boundary).ok()?.to_path_buf();
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

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("a parent directory"))
            .expect("create the parent directory");
        std::fs::write(path, body).expect("write the document");
    }

    #[test]
    fn nested_documents_are_found_case_insensitively_and_sorted() {
        let root = tempfile::tempdir().expect("create a design directory");
        write(root.path(), "SPEC.MD", "# spec");
        write(root.path(), "notes/Design.HTML", "<html></html>");
        write(root.path(), "notes/deep/plan.md", "plan");
        write(root.path(), "notes/ignored.txt", "not a document");
        write(root.path(), "diagram.png", "not a document");

        assert_eq!(
            scan_documents(root.path()),
            vec![
                "SPEC.MD".to_owned(),
                "notes/Design.HTML".to_owned(),
                "notes/deep/plan.md".to_owned(),
            ]
        );
    }

    #[test]
    fn a_missing_directory_simply_has_no_documents() {
        let root = tempfile::tempdir().expect("create a parent directory");

        assert!(scan_documents(&root.path().join("absent")).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_file_pointing_outside_the_boundary_is_not_a_document() {
        let outside = tempfile::tempdir().expect("create an outside directory");
        std::fs::write(outside.path().join("secret.md"), "secret").expect("write outside content");
        let root = tempfile::tempdir().expect("create a design directory");
        write(root.path(), "real.md", "real");
        std::os::unix::fs::symlink(
            outside.path().join("secret.md"),
            root.path().join("escape.md"),
        )
        .expect("create the escaping symlink");

        assert_eq!(scan_documents(root.path()), vec!["real.md".to_owned()]);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_directory_is_never_descended_into() {
        let outside = tempfile::tempdir().expect("create an outside directory");
        std::fs::write(outside.path().join("secret.md"), "secret").expect("write outside content");
        let root = tempfile::tempdir().expect("create a design directory");
        std::os::unix::fs::symlink(outside.path(), root.path().join("linked"))
            .expect("create the escaping directory symlink");

        assert!(scan_documents(root.path()).is_empty());
    }
}
