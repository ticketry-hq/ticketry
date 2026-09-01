//! Exclusive ownership of the selected data directory for the desktop lifetime.

use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

use ticketry_data_directory::{established_data_directory, DataDirectoryGuard};

/// Kept in Tauri managed state for the process lifetime.
pub struct DesktopDataDirectoryOwnership {
    pub data_directory: PathBuf,
    pub guard: Mutex<Option<DataDirectoryGuard>>,
    pub startup_error: Option<String>,
}

fn acquire_data_directory_ownership() -> Result<DesktopDataDirectoryOwnership, String> {
    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    let guard = DataDirectoryGuard::acquire(&data_directory).map_err(|error| {
        format!(
            "could not own selected data directory {}: {error}",
            data_directory.display()
        )
    })?;
    Ok(DesktopDataDirectoryOwnership {
        data_directory,
        guard: Mutex::new(Some(guard)),
        startup_error: None,
    })
}

pub fn data_directory_ownership_for_startup() -> DesktopDataDirectoryOwnership {
    acquire_data_directory_ownership().unwrap_or_else(|error| {
        let data_directory = established_data_directory()
            .unwrap_or_else(|_| env::temp_dir().join("ticketry-unavailable-data-directory"));
        DesktopDataDirectoryOwnership {
            data_directory,
            guard: Mutex::new(None),
            startup_error: Some(error),
        }
    })
}

pub fn release_data_directory_ownership(application: &tauri::AppHandle) {
    let ownership = application.state::<DesktopDataDirectoryOwnership>();
    let guard = ownership
        .guard
        .lock()
        .expect("data-directory lock poisoned")
        .take();
    if let Some(guard) = guard {
        if let Err(error) = guard.release() {
            eprintln!(
                "Ticketry could not release data-directory ownership for {}: {error}",
                ownership.data_directory.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_failure_is_retained_for_the_startup_health_screen() {
        let ownership = DesktopDataDirectoryOwnership {
            data_directory: PathBuf::from("/tmp/ticketry"),
            guard: Mutex::new(None),
            startup_error: Some("another process owns the data directory".to_owned()),
        };

        assert!(ownership
            .guard
            .lock()
            .expect("data-directory lock poisoned")
            .is_none());
        assert_eq!(
            ownership.startup_error.as_deref(),
            Some("another process owns the data directory")
        );
    }
}
