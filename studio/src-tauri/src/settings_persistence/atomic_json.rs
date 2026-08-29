use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::SettingsPersistenceError;

pub(crate) trait AtomicFileOperations: Send + Sync {
    fn replace(&self, source: &Path, destination: &Path) -> std::io::Result<()>;
}

pub(crate) struct RealAtomicFileOperations;

impl AtomicFileOperations for RealAtomicFileOperations {
    fn replace(&self, source: &Path, destination: &Path) -> std::io::Result<()> {
        fs::rename(source, destination)
    }
}

pub(crate) fn write_json<T: Serialize>(
    path: &Path,
    value: &T,
    operations: &dyn AtomicFileOperations,
) -> Result<(), SettingsPersistenceError> {
    let parent = path.parent().ok_or_else(|| {
        SettingsPersistenceError::io(
            path,
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent"),
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| SettingsPersistenceError::io(parent, error))?;
    let bytes = serde_json::to_vec_pretty(value)?;
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = private_file(&temporary)
            .map_err(|error| SettingsPersistenceError::io(&temporary, error))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| SettingsPersistenceError::io(&temporary, error))?;
        operations
            .replace(&temporary, path)
            .map_err(|error| SettingsPersistenceError::io(path, error))?;
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| SettingsPersistenceError::io(parent, error))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Replace `path` with the pretty-printed encoding of `value`, atomically.
pub(crate) fn write_json_atomically<T: Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), SettingsPersistenceError> {
    write_json(path, value, &RealAtomicFileOperations)
}

fn temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("settings.json");
    path.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()))
}

fn private_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ReplaceFailure;

    impl AtomicFileOperations for ReplaceFailure {
        fn replace(&self, _source: &Path, _destination: &Path) -> std::io::Result<()> {
            Err(std::io::Error::other("injected replace failure"))
        }
    }

    #[test]
    fn replace_failure_preserves_original_and_cleans_candidate() {
        let directory = tempfile::tempdir().expect("create settings fixture");
        let path = directory.path().join("profiles.json");
        fs::write(&path, b"original").expect("seed original");

        let error = write_json(
            &path,
            &serde_json::json!({"changed": true}),
            &ReplaceFailure,
        )
        .expect_err("inject replacement failure");

        assert_eq!(error.code(), "settings_file_failed");
        assert_eq!(fs::read(&path).expect("read original"), b"original");
        assert_eq!(
            fs::read_dir(directory.path())
                .expect("list fixture")
                .filter_map(Result::ok)
                .filter(|entry| entry.path().extension().is_some_and(|value| value == "tmp"))
                .count(),
            0
        );
    }
}
