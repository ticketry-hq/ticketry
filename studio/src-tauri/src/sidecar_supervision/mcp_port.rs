//! The MCP port, reserved for a launch and persisted across relaunches.
//!
//! Agents hold long-lived MCP connections, so the port is kept stable when it
//! can be and its rollover is announced when it cannot.

use rand::Rng;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::TcpListener;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

use super::error::{FailureKind, SupervisorError};
use super::events::SupervisorEvent;
use super::loopback_port::{reserve_loopback_port, reserve_pinned_loopback_port};
use super::Supervisor;

pub(super) struct McpPortReservation {
    pub(super) listener: TcpListener,
    pub(super) rollover_from: Option<u16>,
}

pub(super) fn read_persisted_mcp_port(path: &Path) -> Option<u16> {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
}

pub(super) fn persist_mcp_port_atomically(path: &Path, port: u16) -> Result<(), SupervisorError> {
    let parent = path.parent().ok_or_else(|| {
        SupervisorError::new(
            FailureKind::Crash,
            "MCP port persistence path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        SupervisorError::new(
            FailureKind::Crash,
            format!("could not create MCP port persistence directory: {error}"),
        )
    })?;
    let temporary = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .expect("MCP port persistence path has a file name")
            .to_string_lossy(),
        std::process::id(),
        rand::thread_rng().gen::<u64>()
    ));
    let write_result = (|| -> std::io::Result<()> {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary)?;
        writeln!(file, "{port}")?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result.map_err(|error| {
        SupervisorError::new(
            FailureKind::Crash,
            format!("could not persist MCP port selection: {error}"),
        )
    })
}

impl Supervisor {
    pub(super) fn reserve_mcp_port(
        &self,
        allow_persisted_fallback: bool,
    ) -> Result<McpPortReservation, SupervisorError> {
        match self.pinned_mcp_port {
            Some(port) => {
                match reserve_pinned_loopback_port(
                    port,
                    self.options.bind_retry_timeout,
                    self.options.bind_retry_interval,
                ) {
                    Ok(listener) => Ok(McpPortReservation {
                        listener,
                        rollover_from: None,
                    }),
                    Err(_error)
                        if allow_persisted_fallback
                            && self.persist_mcp_port
                            && self.persisted_mcp_port == Some(port) =>
                    {
                        Ok(McpPortReservation {
                            listener: reserve_loopback_port(&self.options.mcp_port_candidates)?,
                            rollover_from: Some(port),
                        })
                    }
                    Err(error) => Err(error),
                }
            }
            None => Ok(McpPortReservation {
                listener: reserve_loopback_port(&self.options.mcp_port_candidates)?,
                rollover_from: None,
            }),
        }
    }

    pub(super) fn commit_mcp_port(
        &mut self,
        active_port: u16,
        rollover_from: Option<u16>,
    ) -> Result<(), SupervisorError> {
        if self.persist_mcp_port && self.persisted_mcp_port != Some(active_port) {
            persist_mcp_port_atomically(&self.commands.mcp_port_path, active_port)?;
            self.persisted_mcp_port = Some(active_port);
        }
        self.pinned_mcp_port = Some(active_port);
        if let Some(previous_port) = rollover_from.filter(|port| *port != active_port) {
            self.emit(SupervisorEvent::McpPortRollover {
                previous_port,
                active_port,
            });
        }
        Ok(())
    }
}
