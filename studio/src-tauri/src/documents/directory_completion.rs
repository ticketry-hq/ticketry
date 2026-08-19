//! Directory-name completion for the trusted local-folder field.
//!
//! This is the one Documents read that is not scoped to an authorized design
//! root, because its whole purpose is to help a person choose one. It is
//! therefore deliberately narrow: it lists directory names only, never file
//! contents, and any invalid or inaccessible path is an empty result rather
//! than an error that would reveal what is there.

use std::path::{Path, PathBuf};

/// Absolute directory paths matching the trailing prefix of `path`.
///
/// A trailing slash (or an empty path, which means the home directory) lists a
/// directory's children; anything else treats the final component as a prefix
/// filter. Hidden directories are excluded unless the prefix itself begins
/// with a dot.
pub fn complete_directories(path: &str) -> Vec<String> {
    let expanded = if path.is_empty() {
        home_directory()
    } else {
        expand_user(path)
    };
    let (base, prefix) = if path.is_empty() || path.ends_with('/') {
        (expanded, String::new())
    } else {
        let candidate = PathBuf::from(&expanded);
        let prefix = candidate
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let parent = candidate
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("/"));
        (parent, prefix)
    };
    if !base.is_dir() {
        return Vec::new();
    }
    let include_hidden = prefix.starts_with('.');
    let Ok(entries) = std::fs::read_dir(&base) else {
        return Vec::new();
    };
    let mut completions: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !include_hidden && name.starts_with('.') {
                return None;
            }
            if !prefix.is_empty() && !name.starts_with(&prefix) {
                return None;
            }
            let path = entry.path();
            Some(
                path.canonicalize()
                    .unwrap_or(path)
                    .to_string_lossy()
                    .into_owned(),
            )
        })
        .collect();
    completions.sort();
    completions
}

/// Expand a leading `~`, leaving every other path untouched.
fn expand_user(path: &str) -> PathBuf {
    if path == "~" {
        return home_directory();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return home_directory().join(rest);
    }
    PathBuf::from(path)
}

fn home_directory() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().expect("create a completion directory");
        for name in ["alpha", "alpine", "beta", ".hidden", ".alpha-hidden"] {
            std::fs::create_dir_all(root.path().join(name)).expect("create a child directory");
        }
        std::fs::write(root.path().join("alphabet.txt"), "not a directory")
            .expect("write a file that must not complete");
        root
    }

    fn names(completions: Vec<String>) -> Vec<String> {
        completions
            .into_iter()
            .map(|path| {
                Path::new(&path)
                    .file_name()
                    .expect("a completion names a directory")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
    }

    #[test]
    fn a_trailing_slash_lists_visible_children_sorted() {
        let root = fixture();
        let listing = complete_directories(&format!("{}/", root.path().display()));

        assert_eq!(names(listing), vec!["alpha", "alpine", "beta"]);
    }

    #[test]
    fn a_final_component_filters_by_prefix_and_excludes_files() {
        let root = fixture();
        let listing = complete_directories(&format!("{}/alp", root.path().display()));

        assert_eq!(names(listing), vec!["alpha", "alpine"]);
    }

    #[test]
    fn a_dotted_prefix_is_the_only_way_to_reach_hidden_directories() {
        let root = fixture();

        assert_eq!(
            names(complete_directories(&format!("{}/.h", root.path().display()))),
            vec![".hidden"]
        );
        assert_eq!(
            names(complete_directories(&format!(
                "{}/.alpha",
                root.path().display()
            ))),
            vec![".alpha-hidden"]
        );
    }

    #[test]
    fn an_inaccessible_or_absent_path_completes_to_nothing() {
        let root = fixture();

        assert!(complete_directories(&format!("{}/absent/", root.path().display())).is_empty());
        assert!(complete_directories("/this/path/does/not/exist/").is_empty());
    }

    #[test]
    fn a_bare_tilde_expands_before_it_is_split() {
        let home = std::env::var("HOME").expect("a home directory");
        let expanded = expand_user("~/documents");

        assert_eq!(expanded, PathBuf::from(&home).join("documents"));
        assert_eq!(expand_user("~"), PathBuf::from(home));
    }
}
