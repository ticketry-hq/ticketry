//! The data-directory socket pathname: where it lives, when it may be
//! reclaimed, and how the runtime that created it removes it again.
//!
//! Every step runs with the data-directory lease held, so a live owner in
//! another process has already refused us before this module inspects the
//! path. The lease does not protect against an unrelated file sitting where
//! the socket goes, or a socket left behind by a killed owner, which is what
//! this module decides.

use std::fs;
use std::io;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::net::UnixListener;

use super::McpStartupError;

pub const MCP_SOCKET_FILE_NAME: &str = "mcp.sock";

/// `sun_path` holds 104 bytes on macOS and 108 on Linux, one of them the
/// terminating NUL.
const MAX_SOCKET_PATH_BYTES: usize = if cfg!(target_os = "macos") { 103 } else { 107 };

const STALE_PROBE_TIMEOUT: Duration = Duration::from_millis(500);

pub fn mcp_socket_path(data_directory: &Path) -> PathBuf {
    data_directory.join(MCP_SOCKET_FILE_NAME)
}

/// Identity of the socket inode this runtime bound, so shutdown never
/// removes a replacement bound by a later owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct BoundSocket {
    device: u64,
    inode: u64,
}

pub(super) async fn bind(path: &Path) -> Result<(UnixListener, BoundSocket), McpStartupError> {
    if path.as_os_str().len() > MAX_SOCKET_PATH_BYTES {
        return Err(McpStartupError::other(format!(
            "WorkTracker MCP socket path {} is {} bytes; Unix sockets allow at most \
             {MAX_SOCKET_PATH_BYTES}. Select a shorter data directory.",
            path.display(),
            path.as_os_str().len(),
        )));
    }
    reclaim_stale_entry(path).await?;
    let listener = UnixListener::bind(path).map_err(|error| {
        McpStartupError::other(format!(
            "could not bind WorkTracker MCP socket {}: {error}",
            path.display()
        ))
    })?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
        let _ = fs::remove_file(path);
        McpStartupError::other(format!(
            "could not restrict WorkTracker MCP socket {} to the current user: {error}",
            path.display()
        ))
    })?;
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        McpStartupError::other(format!(
            "could not inspect the bound WorkTracker MCP socket {}: {error}",
            path.display()
        ))
    })?;
    Ok((
        listener,
        BoundSocket {
            device: metadata.dev(),
            inode: metadata.ino(),
        },
    ))
}

/// Remove `path` only while it is still the socket this runtime bound.
pub(super) fn remove_own(path: &Path, bound: BoundSocket) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.file_type().is_socket()
        && metadata.dev() == bound.device
        && metadata.ino() == bound.inode
    {
        let _ = fs::remove_file(path);
    }
}

async fn reclaim_stale_entry(path: &Path) -> Result<(), McpStartupError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(McpStartupError::other(format!(
                "could not inspect WorkTracker MCP socket path {}: {error}",
                path.display()
            )))
        }
    };
    if !metadata.file_type().is_socket() {
        return Err(McpStartupError::other(format!(
            "WorkTracker MCP socket path {} is occupied by a non-socket entry; \
             Ticketry will not remove it.",
            path.display()
        )));
    }
    match tokio::time::timeout(STALE_PROBE_TIMEOUT, tokio::net::UnixStream::connect(path)).await {
        Ok(Ok(_)) | Err(_) => Err(McpStartupError::SocketInUse {
            diagnostic: format!(
                "WorkTracker MCP socket {} still accepts connections from another process.",
                path.display()
            ),
        }),
        Ok(Err(error)) if error.kind() == io::ErrorKind::ConnectionRefused => fs::remove_file(path)
            .map_err(|error| {
                McpStartupError::other(format!(
                    "could not remove stale WorkTracker MCP socket {}: {error}",
                    path.display()
                ))
            }),
        Ok(Err(error)) => Err(McpStartupError::other(format!(
            "could not probe WorkTracker MCP socket {}: {error}",
            path.display()
        ))),
    }
}
