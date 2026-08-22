//! The application-owned table of commands the supervisor may spawn.
//!
//! There is deliberately no "run this command" API. A caller can only build
//! this table, so no webview input can ever choose a program, its arguments,
//! or its environment.

use std::ffi::OsString;
use std::fs::{self};
use std::path::{Path, PathBuf};
use std::process::Command;

use super::error::{FailureKind, SupervisorError};
use super::log_rotation::sidecar_log_path;

pub(super) const DESKTOP_ORIGIN_ENV: &str = "MUXED_DESKTOP_ORIGIN";

pub(super) const MCP_PORT_FILE_NAME: &str = "mcp-port";

pub(super) const PYINSTALLER_PARENT_ENV: [&str; 3] = [
    "_PYI_APPLICATION_HOME_DIR",
    "_PYI_ARCHIVE_FILE",
    "_PYI_PARENT_PROCESS_LEVEL",
];

pub(super) fn sanitize_packaged_process_environment(command: &mut Command) {
    for name in PYINSTALLER_PARENT_ENV {
        command.env_remove(name);
    }
}

#[derive(Debug, Clone)]
pub(super) struct BackendCommand {
    pub(super) program: PathBuf,
    pub(super) fixed_arguments: Vec<OsString>,
    pub(super) environment: Vec<(OsString, OsString)>,
    pub(super) pass_port_argument: bool,
}

/// A fixed, application-owned command table.  This intentionally exposes no
/// arbitrary program or argument setters.
#[derive(Debug, Clone)]
pub struct CommandTable {
    pub(super) backend: BackendCommand,
    pub(super) mcp: Option<BackendCommand>,
    pub(super) sidecar_log_path: PathBuf,
    pub(super) mcp_port_path: PathBuf,
}

impl CommandTable {
    /// Builds the sole production command.  Packaging supplies this absolute
    /// path to the target-specific sidecar binary.
    pub fn packaged_backend(
        binary: impl AsRef<Path>,
        data_dir: impl AsRef<Path>,
        desktop_origin: &str,
    ) -> Result<Self, SupervisorError> {
        let program = validate_program(binary.as_ref())?;
        let data_dir = data_dir.as_ref();
        if !data_dir.is_absolute() {
            return Err(SupervisorError::new(
                FailureKind::Crash,
                "sidecar data directory must be an absolute desktop-owned path",
            ));
        }
        Ok(Self {
            backend: BackendCommand {
                program,
                fixed_arguments: vec![
                    OsString::from("--data-dir"),
                    data_dir.as_os_str().to_os_string(),
                ],
                environment: vec![(
                    OsString::from(DESKTOP_ORIGIN_ENV),
                    OsString::from(desktop_origin),
                )],
                pass_port_argument: true,
            },
            mcp: None,
            sidecar_log_path: sidecar_log_path(data_dir),
            mcp_port_path: data_dir.join(MCP_PORT_FILE_NAME),
        })
    }

    /// Builds the packaged backend plus the MCP mode embedded in the same
    /// validated multi-call executable.
    pub fn packaged_services(
        binary: impl AsRef<Path>,
        data_dir: impl AsRef<Path>,
        desktop_origin: &str,
    ) -> Result<Self, SupervisorError> {
        let mut commands = Self::packaged_backend(binary, data_dir, desktop_origin)?;
        commands.mcp = Some(BackendCommand {
            program: commands.backend.program.clone(),
            fixed_arguments: vec![OsString::from("mcp")],
            environment: Vec::new(),
            pass_port_argument: false,
        });
        Ok(commands)
    }

    /// Adds environment values selected by another application-owned service.
    /// This remains deliberately private to the Rust desktop shell: callers
    /// cannot construct arbitrary process commands or arguments.
    pub fn with_environment(mut self, environment: Vec<(String, String)>) -> Self {
        let environment = environment
            .into_iter()
            .map(|(name, value)| (OsString::from(name), OsString::from(value)))
            .collect::<Vec<_>>();
        self.backend.environment.extend(environment.clone());
        if let Some(mcp) = &mut self.mcp {
            mcp.environment.extend(environment);
        }
        self
    }

    #[cfg(test)]
    pub(super) fn contract_stub(
        program: PathBuf,
        arguments: Vec<OsString>,
        environment: Vec<(OsString, OsString)>,
        sidecar_log_path: PathBuf,
    ) -> Self {
        Self {
            backend: BackendCommand {
                program,
                fixed_arguments: arguments,
                environment,
                pass_port_argument: false,
            },
            mcp: None,
            mcp_port_path: sidecar_log_path.with_file_name(format!(
                "{}.mcp-port",
                sidecar_log_path
                    .file_name()
                    .expect("stub sidecar log path has a file name")
                    .to_string_lossy()
            )),
            sidecar_log_path,
        }
    }
}

pub(super) fn validate_program(path: &Path) -> Result<PathBuf, SupervisorError> {
    if !path.is_absolute() {
        return Err(SupervisorError::new(
            FailureKind::Crash,
            "sidecar executable must be an absolute application-owned path",
        ));
    }
    let metadata = fs::metadata(path).map_err(|error| {
        SupervisorError::new(
            FailureKind::Crash,
            format!("sidecar executable is unavailable: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(SupervisorError::new(
            FailureKind::Crash,
            "sidecar executable must be a file",
        ));
    }
    Ok(path.to_path_buf())
}
