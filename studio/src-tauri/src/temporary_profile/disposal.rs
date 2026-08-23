//! Whether a temporary profile directory may be destroyed, and destroying it.
//!
//! Removal is refused for any path that is not a profile this process created
//! under the system temporary root, and is only ever reached once the cleanup
//! journal has proved there is no terminal history left to lose.

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::Path;

use super::profile::TEMP_SQLITE_PREFIX;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProfileRemoval {
    Removed,
    Failed(String),
}

/// A path is removable only when it is a direct child of the temporary root
/// carrying this process's profile prefix.
pub(super) fn is_temporary_profile(path: &Path, temporary_root: &Path) -> bool {
    path.parent() == Some(temporary_root)
        && path
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|name| name.starts_with(TEMP_SQLITE_PREFIX))
}

pub(super) fn remove(path: &Path) -> ProfileRemoval {
    match fs::remove_dir_all(path) {
        Ok(()) => ProfileRemoval::Removed,
        Err(error) if error.kind() == io::ErrorKind::NotFound => ProfileRemoval::Removed,
        Err(error) => ProfileRemoval::Failed(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_prefixed_child_of_the_temporary_root_is_removable() {
        let root = Path::new("/tmp");
        assert!(is_temporary_profile(
            &root.join(format!("{TEMP_SQLITE_PREFIX}1-2")),
            root
        ));
        assert!(!is_temporary_profile(&root.join("something-else"), root));
        assert!(!is_temporary_profile(
            &root.join("nested").join(format!("{TEMP_SQLITE_PREFIX}1-2")),
            root
        ));
        assert!(!is_temporary_profile(
            Path::new("/home/user/.config/worktracker-studio"),
            root
        ));
    }

    #[test]
    fn removing_an_absent_profile_is_success() {
        let directory = tempfile::tempdir().expect("create fixture directory");
        let absent = directory.path().join("already-gone");
        assert_eq!(remove(&absent), ProfileRemoval::Removed);
    }
}
