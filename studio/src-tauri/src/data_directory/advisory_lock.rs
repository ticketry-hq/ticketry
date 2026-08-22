//! The kernel advisory lock that decides exclusivity.
//!
//! A lock taken this way is released when the owning process is forcibly quit,
//! which is exactly why it, and not the metadata file, is the source of truth.

use std::fs::File;

#[cfg(unix)]
pub(super) fn try_lock_exclusive(file: &File) -> std::io::Result<bool> {
    use std::os::fd::AsRawFd;

    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        Ok(true)
    } else {
        match std::io::Error::last_os_error().kind() {
            std::io::ErrorKind::WouldBlock => Ok(false),
            _ => Err(std::io::Error::last_os_error()),
        }
    }
}

#[cfg(unix)]
pub(super) fn unlock(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;

    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
pub(super) fn try_lock_exclusive(_file: &File) -> std::io::Result<bool> {
    // This target is not part of the current desktop release.  Refuse rather
    // than pretending that an unlocked metadata file provides exclusivity.
    Ok(false)
}

#[cfg(not(unix))]
pub(super) fn unlock(_file: &File) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
pub(super) fn owner_is_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0
        || matches!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::EPERM)
        )
}

#[cfg(not(unix))]
pub(super) fn owner_is_alive(_pid: u32) -> bool {
    true
}
