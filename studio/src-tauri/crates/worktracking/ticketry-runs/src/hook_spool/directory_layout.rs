//! Where the provider hook spool lives, and how startup proves the root is
//! safe before anything is allowed to write into it or drain it.

use std::path::{Path, PathBuf};

/// The absolute spool root for one data directory.
///
/// The spool is keyed by a digest of the data directory so two installs on one
/// machine never share a root, and it lives outside the data directory because
/// the hook runner is a separate process that only receives this path.
pub fn hook_spool_directory(data_directory: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(data_directory.to_string_lossy().as_bytes());
    let identity = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    std::env::temp_dir().join(format!("ticketry-hook-spool-{identity}"))
}

/// Create and validate the spool root before the path is handed to anything
/// that can reach it.
///
/// The spool lives outside the data directory, so a first open, a cleared
/// temporary directory, or a data directory that has never launched a provider
/// all reach startup with no root at all. A missing root stays a drain
/// diagnostic — that is how a root removed underneath a running install is
/// noticed — so the owner of the layout creates it up front instead. The same
/// safety rule the drain applies is applied here: a symlinked or non-directory
/// root is a startup failure rather than something a launched provider is
/// pointed at.
pub fn ensure_hook_spool_directory(data_directory: &Path) -> Result<PathBuf, String> {
    let directory = hook_spool_directory(data_directory);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create the provider hook spool directory: {error}"))?;
    let metadata = std::fs::symlink_metadata(&directory)
        .map_err(|error| format!("could not inspect the provider hook spool directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "the provider hook spool path is not a directory: {}",
            directory.display()
        ));
    }
    Ok(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn distinct_data_directories_get_distinct_absolute_roots() {
        let first = hook_spool_directory(Path::new("/tmp/profile-one"));
        let second = hook_spool_directory(Path::new("/tmp/profile-two"));
        assert!(first.is_absolute());
        assert_ne!(first, second);
        assert_eq!(first, hook_spool_directory(Path::new("/tmp/profile-one")));
    }

    #[test]
    fn a_clean_profile_gets_a_validated_root_that_a_required_drain_accepts() {
        let data_directory = TempDir::new().expect("data directory");
        let expected = hook_spool_directory(data_directory.path());
        let _ = std::fs::remove_dir_all(&expected);

        let directory =
            ensure_hook_spool_directory(data_directory.path()).expect("clean profile spool root");

        assert_eq!(directory, expected);
        assert!(directory.is_dir());
        // Idempotent: an already prepared root is validated, not rejected.
        assert_eq!(
            ensure_hook_spool_directory(data_directory.path()).expect("existing spool root"),
            expected
        );
        let _ = std::fs::remove_dir_all(&expected);
    }

    #[test]
    fn a_symlinked_root_fails_startup_instead_of_being_exposed() {
        let data_directory = TempDir::new().expect("data directory");
        let target = TempDir::new().expect("symlink target");
        let root = hook_spool_directory(data_directory.path());
        let _ = std::fs::remove_dir_all(&root);
        std::os::unix::fs::symlink(target.path(), &root).expect("symlinked spool root");

        let error = ensure_hook_spool_directory(data_directory.path())
            .expect_err("a symlinked spool root is refused");

        assert!(error.contains("not a directory"), "{error}");
        let _ = std::fs::remove_file(&root);
    }

    #[test]
    fn a_file_where_the_root_belongs_fails_startup() {
        let data_directory = TempDir::new().expect("data directory");
        let root = hook_spool_directory(data_directory.path());
        let _ = std::fs::remove_dir_all(&root);
        std::fs::write(&root, b"not a spool").expect("occupying file");

        let error = ensure_hook_spool_directory(data_directory.path())
            .expect_err("a file spool root is refused");

        assert!(
            error.contains("could not create the provider hook spool directory")
                || error.contains("not a directory"),
            "{error}"
        );
        let _ = std::fs::remove_file(&root);
    }
}
