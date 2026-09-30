use std::{io, path::Path};

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::{ffi::CString, os::unix::ffi::OsStrExt};

#[cfg(target_os = "macos")]
pub(super) fn exchange(replacement: &Path, destination: &Path) -> io::Result<()> {
    let replacement = path(replacement)?;
    let destination = path(destination)?;
    if unsafe {
        libc::renamex_np(
            replacement.as_ptr(),
            destination.as_ptr(),
            libc::RENAME_SWAP,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
pub(super) fn exchange(replacement: &Path, destination: &Path) -> io::Result<()> {
    let replacement = path(replacement)?;
    let destination = path(destination)?;
    if unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            replacement.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn path(path: &Path) -> io::Result<CString> {
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Path contains a null byte."))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(super) fn exchange(_replacement: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Safe concurrent Codex configuration writes are not supported on this platform.",
    ))
}
