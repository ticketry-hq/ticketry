//! The exclusive lease itself.
//!
//! The guard owns no child process. The lifecycle supervisor acquires it before
//! spawning a backend and releases it after reaping the children it owns.

use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

use super::advisory_lock::{owner_is_alive, try_lock_exclusive, unlock};
use super::development_mode::{
    development_stack_access, development_stack_state, DevelopmentMode, DevelopmentStackState,
    DEVELOPMENT_BACKEND_PORT,
};
use super::error::{io_error, OwnershipError};
use super::location::established_data_directory;
use super::owner_record::{
    clear_owner, now_millis, random_nonce, read_owner, write_owner, OwnerIdentity, LOCK_FILE_NAME,
};

/// Result of deciding how the desktop should access the local backend.
#[derive(Debug)]
pub enum DataDirectoryAccess {
    Owned(DataDirectoryGuard),
    DevelopmentStack,
}

/// An exclusive, process-scoped lease for a directory that contains SQLite
/// files and configuration.  Dropping this guard releases the kernel lock.
#[derive(Debug)]
pub struct DataDirectoryGuard {
    file: File,
    lock_path: PathBuf,
    owner: OwnerIdentity,
    reclaimed_stale_metadata: bool,
    released: bool,
}

impl DataDirectoryGuard {
    pub fn acquire_established(
        mode: DevelopmentMode,
    ) -> Result<DataDirectoryAccess, OwnershipError> {
        Self::acquire(
            &established_data_directory()?,
            mode,
            DEVELOPMENT_BACKEND_PORT,
        )
    }

    pub fn acquire(
        data_directory: &Path,
        mode: DevelopmentMode,
        development_backend_port: u16,
    ) -> Result<DataDirectoryAccess, OwnershipError> {
        fs::create_dir_all(data_directory).map_err(|error| {
            OwnershipError::Io(format!(
                "could not create selected data directory {}: {error}",
                data_directory.display()
            ))
        })?;
        match development_stack_state(data_directory, development_backend_port) {
            DevelopmentStackState::Verified => {
                if development_stack_access(mode, true, development_backend_port)? {
                    return Ok(DataDirectoryAccess::DevelopmentStack);
                }
            }
            DevelopmentStackState::Absent => {
                if mode == DevelopmentMode::Connect {
                    return Err(OwnershipError::DevelopmentStackUnavailable {
                        port: development_backend_port,
                    });
                }
            }
        }

        let lock_path = data_directory.join(LOCK_FILE_NAME);
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|error| {
                OwnershipError::Io(format!(
                    "could not open ownership file {}: {error}",
                    lock_path.display()
                ))
            })?;

        if !try_lock_exclusive(&file).map_err(io_error)? {
            return Err(OwnershipError::DataDirectoryInUse {
                owner: read_owner(&mut file),
            });
        }

        let previous_owner = read_owner(&mut file);
        let reclaimed_stale_metadata = previous_owner
            .as_ref()
            .is_some_and(|owner| !owner_is_alive(owner.pid));
        let owner = OwnerIdentity {
            pid: std::process::id(),
            nonce: random_nonce(),
            acquired_at_millis: now_millis(),
        };
        write_owner(&mut file, &owner).map_err(io_error)?;

        Ok(DataDirectoryAccess::Owned(Self {
            file,
            lock_path,
            owner,
            reclaimed_stale_metadata,
            released: false,
        }))
    }

    pub fn owner(&self) -> &OwnerIdentity {
        &self.owner
    }

    pub fn lock_path(&self) -> &Path {
        &self.lock_path
    }

    pub fn reclaimed_stale_metadata(&self) -> bool {
        self.reclaimed_stale_metadata
    }

    pub fn release(mut self) -> Result<(), OwnershipError> {
        self.release_inner()
    }

    fn release_inner(&mut self) -> Result<(), OwnershipError> {
        if self.released {
            return Ok(());
        }
        clear_owner(&mut self.file).map_err(io_error)?;
        unlock(&self.file).map_err(io_error)?;
        self.released = true;
        Ok(())
    }
}

impl Drop for DataDirectoryGuard {
    fn drop(&mut self) {
        let _ = self.release_inner();
    }
}
