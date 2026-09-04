use super::approved_tool_path;
use crate::tool_discovery::SupportedTool;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fmt;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct ApprovedArgv {
    pub(super) executable: PathBuf,
    pub(super) arguments: Vec<OsString>,
    pub(super) working_directory: PathBuf,
    pub(super) environment: BTreeMap<String, String>,
}

impl ApprovedArgv {
    pub fn for_tool<I, S>(
        tool: SupportedTool,
        arguments: I,
        working_directory: PathBuf,
        environment: BTreeMap<String, String>,
    ) -> Result<Self, TmuxAdapterError>
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        if tool == SupportedTool::Tmux || !working_directory.is_absolute() {
            return Err(TmuxAdapterError::InvalidOperation);
        }
        for (name, value) in &environment {
            if !valid_environment_name(name) || value.contains('\0') {
                return Err(TmuxAdapterError::InvalidOperation);
            }
        }
        Ok(Self {
            executable: approved_tool_path(tool)?,
            arguments: arguments.into_iter().map(Into::into).collect(),
            working_directory,
            environment,
        })
    }

    pub(crate) fn for_login_shell(
        shell: PathBuf,
        working_directory: PathBuf,
    ) -> Result<Self, TmuxAdapterError> {
        if !shell.is_absolute()
            || !shell.is_file()
            || !working_directory.is_absolute()
            || !working_directory.is_dir()
        {
            return Err(TmuxAdapterError::InvalidOperation);
        }
        let environment = PathBuf::from("/usr/bin/env");
        if !environment.is_file() {
            return Err(TmuxAdapterError::InvalidOperation);
        }
        Ok(Self {
            executable: environment,
            arguments: vec![
                OsString::from("-u"),
                OsString::from("NO_COLOR"),
                shell.into_os_string(),
                OsString::from("-l"),
            ],
            working_directory,
            environment: BTreeMap::new(),
        })
    }

    pub(crate) fn for_app_command(
        shell: PathBuf,
        command: String,
        working_directory: PathBuf,
        environment: BTreeMap<String, String>,
    ) -> Result<Self, TmuxAdapterError> {
        if !shell.is_absolute()
            || !shell.is_file()
            || command.trim().is_empty()
            || command.contains('\0')
            || !working_directory.is_absolute()
            || !working_directory.is_dir()
            || environment
                .iter()
                .any(|(name, value)| !valid_app_environment_name(name) || value.contains('\0'))
        {
            return Err(TmuxAdapterError::InvalidOperation);
        }
        Ok(Self {
            executable: shell,
            arguments: vec![OsString::from("-lc"), OsString::from(command)],
            working_directory,
            environment,
        })
    }
}

fn valid_app_environment_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte == b'_' || byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeIdentity {
    agent_run_id: String,
    runtime_namespace: String,
}

impl RuntimeIdentity {
    pub fn new(agent_run_id: &str, runtime_namespace: &str) -> Result<Self, TmuxAdapterError> {
        validate_identifier(agent_run_id)?;
        validate_identifier(runtime_namespace)?;
        Ok(Self {
            agent_run_id: agent_run_id.into(),
            runtime_namespace: runtime_namespace.into(),
        })
    }
    pub fn agent_run_id(&self) -> &str {
        &self.agent_run_id
    }
    pub fn runtime_namespace(&self) -> &str {
        &self.runtime_namespace
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TerminalGeometry {
    pub columns: u16,
    pub rows: u16,
}
impl TerminalGeometry {
    pub fn new(columns: u16, rows: u16) -> Result<Self, TmuxAdapterError> {
        validate_geometry(columns, rows)?;
        Ok(Self { columns, rows })
    }
}

#[derive(Clone, Debug)]
pub struct CreateSession {
    pub identity: RuntimeIdentity,
    pub geometry: TerminalGeometry,
    pub command: ApprovedArgv,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeObservation {
    Running,
    Exited { exit_code: Option<i32> },
    Missing,
    Foreign,
    Ambiguous,
    Unavailable { reason: String },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CreateOutcome {
    Created,
    Existing(RuntimeObservation),
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum KillOutcome {
    Killed,
    AlreadyMissing,
    Refused(RuntimeObservation),
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnedSession {
    pub agent_run_id: String,
    pub runtime_namespace: String,
    pub running: bool,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InventoryConflictKind {
    Foreign,
    Ambiguous,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InventoryEntry {
    Owned {
        session: OwnedSession,
        legacy_namespace: bool,
    },
    Conflict {
        fingerprint: String,
        kind: InventoryConflictKind,
    },
}

#[derive(Debug)]
pub enum TmuxAdapterError {
    InvalidIdentifier,
    InvalidGeometry { columns: u16, rows: u16 },
    InvalidScrollLines { lines: u16 },
    InputTooLarge { bytes: usize },
    InvalidOperation,
    Unavailable(String),
}
impl fmt::Display for TmuxAdapterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidIdentifier => write!(f, "terminal runtime identifier is invalid"),
            Self::InvalidGeometry { columns, rows } => {
                write!(f, "terminal size {columns}x{rows} is invalid")
            }
            Self::InvalidScrollLines { lines } => {
                write!(f, "terminal scroll line count {lines} is invalid")
            }
            Self::InputTooLarge { bytes } => {
                write!(f, "terminal input of {bytes} bytes exceeds the limit")
            }
            Self::InvalidOperation => write!(f, "tmux operation is not approved"),
            Self::Unavailable(message) => write!(f, "tmux is unavailable: {message}"),
        }
    }
}
impl std::error::Error for TmuxAdapterError {}

#[cfg(test)]
mod app_command_tests {
    use super::*;

    #[test]
    fn app_command_preserves_shell_command_folder_and_environment() {
        let directory = tempfile::tempdir().unwrap();
        let command = ApprovedArgv::for_app_command(
            PathBuf::from("/bin/sh"),
            "npm run dev".to_owned(),
            directory.path().to_owned(),
            BTreeMap::from([("PORT".to_owned(), "5174".to_owned())]),
        )
        .unwrap();

        assert_eq!(command.executable, PathBuf::from("/bin/sh"));
        assert_eq!(
            command.arguments,
            vec![OsString::from("-lc"), OsString::from("npm run dev")]
        );
        assert_eq!(command.working_directory, directory.path());
        assert_eq!(command.environment["PORT"], "5174");
    }

    #[test]
    fn app_command_rejects_environment_names_the_process_cannot_receive() {
        let directory = tempfile::tempdir().unwrap();
        let error = ApprovedArgv::for_app_command(
            PathBuf::from("/bin/sh"),
            "npm run dev".to_owned(),
            directory.path().to_owned(),
            BTreeMap::from([("NOT-AN-ENV".to_owned(), "value".to_owned())]),
        )
        .unwrap_err();

        assert!(matches!(error, TmuxAdapterError::InvalidOperation));
    }
}

pub(super) fn validate_identifier(value: &str) -> Result<(), TmuxAdapterError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    valid
        .then_some(())
        .ok_or(TmuxAdapterError::InvalidIdentifier)
}
pub(super) fn validate_geometry(columns: u16, rows: u16) -> Result<(), TmuxAdapterError> {
    if columns == 0 || rows == 0 || columns > 500 || rows > 500 {
        Err(TmuxAdapterError::InvalidGeometry { columns, rows })
    } else {
        Ok(())
    }
}
pub(super) fn valid_environment_name(name: &str) -> bool {
    matches!(
        name,
        "ANTHROPIC_API_KEY"
            | "CI"
            | "CODEX_HOME"
            | "COLORTERM"
            | "FORCE_COLOR"
            | "GEMINI_API_KEY"
            | "HOME"
            | "LANG"
            | "LC_ALL"
            | "LC_CTYPE"
            | "NO_COLOR"
            | "OPENAI_API_KEY"
            | "PATH"
            | "TERM"
            | "TMPDIR"
            | "XDG_CACHE_HOME"
            | "XDG_CONFIG_HOME"
            | "XDG_DATA_HOME"
    ) || name.starts_with("TICKETRY_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_shell_uses_login_mode_and_removes_host_no_color() {
        let command = ApprovedArgv::for_login_shell(
            PathBuf::from("/bin/sh"),
            std::env::current_dir().unwrap(),
        )
        .unwrap();
        assert_eq!(command.executable, PathBuf::from("/usr/bin/env"));
        assert_eq!(
            command.arguments,
            ["-u", "NO_COLOR", "/bin/sh", "-l"].map(OsString::from)
        );
        assert!(command.environment.is_empty());
    }
}
