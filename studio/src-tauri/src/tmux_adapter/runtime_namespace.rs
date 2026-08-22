use std::path::PathBuf;

use sha2::{Digest, Sha256};

use super::{validate_identifier, TmuxAdapterError, DEFAULT_SOCKET};

/// Opaque identity of the effective tmux socket endpoint used by this process.
/// This matches the adopted Python runtime identity byte for byte.
pub fn current_runtime_namespace() -> Result<String, TmuxAdapterError> {
    let socket = std::env::var("MUXED_TMUX_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET.into());
    validate_identifier(&socket)?;
    if socket.len() > 64 {
        return Err(TmuxAdapterError::Unavailable("invalid socket name".into()));
    }
    let root = std::env::var_os("TMUX_TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    let normalized = std::fs::canonicalize(&root).unwrap_or(root);
    #[cfg(unix)]
    let uid = unsafe { libc::geteuid() };
    #[cfg(not(unix))]
    let uid = 0;
    let endpoint = format!("{}\0{uid}\0{socket}", normalized.display());
    let digest = format!("{:x}", Sha256::digest(endpoint.as_bytes()));
    Ok(format!("tmux-{}", &digest[..32]))
}
