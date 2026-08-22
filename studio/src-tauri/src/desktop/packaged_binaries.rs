//! Locating the helper executables Tauri ships beside the desktop binary.
//! Bundle targets disagree about where they land, so every known layout is
//! probed in a fixed order.

use std::env;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::desktop::environment::{smoke_startup_exit_requested, SMOKE_SIDECAR_BINARY};
use crate::sidecar_supervision::release_manifest;

const HOOK_RUNNER_BINARY: &str = "ticketry-hook";

fn packaged_resource_binary(
    application: &tauri::App,
    binary: &str,
    missing_message: &str,
) -> Result<PathBuf, String> {
    let executable = env::current_exe()
        .map_err(|error| format!("could not locate the desktop executable: {error}"))?;
    if let Some(packaged_sibling) = packaged_executable_sibling(&executable, binary) {
        return Ok(packaged_sibling);
    }

    let resource_dir = application
        .path()
        .resource_dir()
        .map_err(|error| format!("could not locate packaged runtime resources: {error}"))?;
    packaged_binary_candidates(&resource_dir, &executable, binary)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| missing_message.to_owned())
}

fn packaged_executable_sibling(executable: &Path, binary: &str) -> Option<PathBuf> {
    executable
        .parent()
        .map(|parent| parent.join(binary))
        .filter(|path| path.is_file())
}

fn packaged_binary_candidates(
    resource_dir: &Path,
    executable: &Path,
    binary: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::with_capacity(3);
    // On macOS, Tauri places external binaries beside the main executable in
    // `Contents/MacOS`, while ordinary resources live in `Contents/Resources`.
    if let Some(executable_dir) = executable.parent() {
        candidates.push(executable_dir.join(binary));
    }
    // Keep the resource layouts used by other bundle targets and older builds.
    candidates.extend([
        resource_dir.join(binary),
        resource_dir.join("binaries").join(binary),
    ]);
    candidates
}

pub(crate) fn sidecar_binary(application: &tauri::App) -> Result<PathBuf, String> {
    if smoke_startup_exit_requested() {
        return env::var_os(SMOKE_SIDECAR_BINARY)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| format!("{SMOKE_SIDECAR_BINARY} must name the absolute built sidecar"));
    }

    let binary = release_manifest::packaged_sidecar_name()?;
    packaged_resource_binary(
        application,
        &binary,
        "packaged backend sidecar is missing from application resources",
    )
}

pub(crate) fn hook_runner_binary(application: &tauri::App) -> Result<PathBuf, String> {
    let binary = format!("{HOOK_RUNNER_BINARY}{}", env::consts::EXE_SUFFIX);
    packaged_resource_binary(
        application,
        &binary,
        "packaged hook runner is missing from application resources",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_helpers_include_the_macos_executable_sibling_directory() {
        let candidates = packaged_binary_candidates(
            Path::new("/Applications/Ticketry.app/Contents/Resources"),
            Path::new("/Applications/Ticketry.app/Contents/MacOS/ticketry"),
            "muxed-backend",
        );

        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/Applications/Ticketry.app/Contents/MacOS/muxed-backend"),
                PathBuf::from("/Applications/Ticketry.app/Contents/Resources/muxed-backend"),
                PathBuf::from(
                    "/Applications/Ticketry.app/Contents/Resources/binaries/muxed-backend"
                ),
            ]
        );
    }

    #[test]
    fn packaged_helper_sibling_does_not_require_resource_directory_resolution() {
        let directory = env::temp_dir().join(format!(
            "ticketry-packaged-helper-sibling-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("create packaged helper test directory");
        let executable = directory.join("ticketry");
        let helper = directory.join("muxed-backend");
        std::fs::write(&helper, b"packaged helper").expect("write packaged helper");

        assert_eq!(
            packaged_executable_sibling(&executable, "muxed-backend"),
            Some(helper)
        );
        let _ = std::fs::remove_dir_all(directory);
    }
}
