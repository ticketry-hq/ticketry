use std::ffi::CStr;
use std::path::{Path, PathBuf};

use crate::tmux_adapter::{ApprovedArgv, TmuxAdapterError};

use crate::launch::terminal_session::{TerminalLaunchError, TerminalLaunchErrorCode};

pub(crate) fn approved_login_shell(
    working_directory: PathBuf,
) -> Result<ApprovedArgv, TerminalLaunchError> {
    let shell = environment_shell()
        .or_else(account_shell)
        .unwrap_or_else(|| PathBuf::from("/bin/sh"));
    ApprovedArgv::for_login_shell(shell, working_directory).map_err(map_error)
}

fn environment_shell() -> Option<PathBuf> {
    std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| approved_executable(path))
}

#[cfg(unix)]
fn account_shell() -> Option<PathBuf> {
    let buffer_size = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let mut buffer = vec![0_u8; usize::try_from(buffer_size).unwrap_or(16_384).max(1_024)];
    let mut record = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut result = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwuid_r(
            libc::geteuid(),
            record.as_mut_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return None;
    }
    let record = unsafe { record.assume_init() };
    if record.pw_shell.is_null() {
        return None;
    }
    let path = PathBuf::from(
        unsafe { CStr::from_ptr(record.pw_shell) }
            .to_string_lossy()
            .as_ref(),
    );
    approved_executable(&path).then_some(path)
}

#[cfg(not(unix))]
fn account_shell() -> Option<PathBuf> {
    None
}

fn approved_executable(path: &Path) -> bool {
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0);
    }
    #[cfg(not(unix))]
    true
}

fn map_error(_: TmuxAdapterError) -> TerminalLaunchError {
    TerminalLaunchError::new(
        TerminalLaunchErrorCode::RuntimeUnavailable,
        "The approved account login shell is unavailable.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approved_executable_rejects_relative_and_missing_shells() {
        assert!(!approved_executable(Path::new("bin/sh")));
        assert!(!approved_executable(Path::new(
            "/definitely/missing/ticketry-shell"
        )));
    }
}
