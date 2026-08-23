//! The exclusive lease itself.
//!
//! The desktop acquires this lease before opening its in-process database.

use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

use super::advisory_lock::{owner_is_alive, try_lock_exclusive, unlock};
use super::error::{io_error, OwnershipError};
use super::location::established_data_directory;
use super::owner_record::{
    clear_owner, now_millis, random_nonce, read_owner, write_owner, OwnerIdentity, LOCK_FILE_NAME,
};

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
    pub fn acquire_established() -> Result<Self, OwnershipError> {
        Self::acquire(&established_data_directory()?)
    }

    pub fn acquire(data_directory: &Path) -> Result<Self, OwnershipError> {
        fs::create_dir_all(data_directory).map_err(|error| {
            OwnershipError::Io(format!(
                "could not create selected data directory {}: {error}",
                data_directory.display()
            ))
        })?;
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

        Ok(Self {
            file,
            lock_path,
            owner,
            reclaimed_stale_metadata,
            released: false,
        })
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

/// The live process recorded as holding this installation's lease.
///
/// The advisory lock, not this record, decides exclusivity. Adoption reads the
/// record anyway because it needs to *name* the conflicting owner in a refusal,
/// and because it runs inside the process that already holds the lock — where
/// asking the kernel again would only say "yes, you".
pub fn live_lease_owner(data_directory: &Path) -> Option<OwnerIdentity> {
    let mut file = OpenOptions::new()
        .read(true)
        .open(data_directory.join(LOCK_FILE_NAME))
        .ok()?;
    let owner = read_owner(&mut file)?;
    owner_is_alive(owner.pid).then_some(owner)
}
