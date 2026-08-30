//! Verified tmux operations for Ticketry-owned terminal runtimes.
//!
//! This is the only product module that derives tmux identities or executes
//! product-session tmux commands. Callers provide structured identities,
//! approved provider arguments, geometry, and bounded viewer controls.

use crate::tool_discovery::{preflight_report, SupportedTool, ToolHealth};
use portable_pty::CommandBuilder;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

mod hosted_command;
mod inventory;
mod runtime_namespace;
mod session_naming;
mod session_records;
mod types;

use hosted_command::HostedCommand;
pub use runtime_namespace::current_runtime_namespace;
use session_naming::session_name;
pub use session_naming::{PersistedSessionName, SESSION_PREFIX};
use session_records::{observe_records, SessionRecord};
use types::{validate_geometry, validate_identifier};
pub use types::{
    ApprovedArgv, CreateOutcome, CreateSession, InventoryConflictKind, InventoryEntry, KillOutcome,
    OwnedSession, RuntimeIdentity, RuntimeObservation, TerminalGeometry, TmuxAdapterError,
};

const DEFAULT_SOCKET: &str = "muxed";
const OWNER_KEY: &str = "@pt-owner";
const OWNER_VALUE: &str = "ticketry-v1";
const RUN_KEY: &str = "@pt-agent-run-id";
const NAMESPACE_KEY: &str = "@pt-runtime-namespace";
const MAX_SCROLL_LINES: u16 = 500;
pub const MAX_INPUT_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub struct TmuxAdapter {
    executable: PathBuf,
    socket: String,
    socket_directory: Option<OsString>,
}

impl TmuxAdapter {
    pub fn discover() -> Result<Self, TmuxAdapterError> {
        let socket = std::env::var("MUXED_TMUX_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET.into());
        validate_identifier(&socket)?;
        if socket.len() > 64 {
            return Err(TmuxAdapterError::Unavailable("invalid socket name".into()));
        }
        Ok(Self {
            executable: approved_tool_path(SupportedTool::Tmux)?,
            socket,
            socket_directory: std::env::var_os("TMUX_TMPDIR"),
        })
    }

    pub fn observe(&self, identity: &RuntimeIdentity) -> RuntimeObservation {
        match self.read_sessions() {
            Ok(sessions) => observe_records(identity, &sessions),
            Err(error) => RuntimeObservation::Unavailable {
                reason: error.to_string(),
            },
        }
    }

    pub fn create(&self, request: &CreateSession) -> Result<CreateOutcome, TmuxAdapterError> {
        let observed = self.observe(&request.identity);
        if observed != RuntimeObservation::Missing {
            return Ok(CreateOutcome::Existing(observed));
        }
        let session = session_name(request.identity.agent_run_id());
        let columns = request.geometry.columns.to_string();
        let rows = request.geometry.rows.to_string();
        let hosted = HostedCommand::prepare(request.identity.agent_run_id(), &request.command)?;
        let mut command = self.command();
        command
            .args([
                "new-session",
                "-d",
                "-s",
                &session,
                "-x",
                &columns,
                "-y",
                &rows,
                "-c",
            ])
            .arg(&request.command.working_directory);
        for (name, value) in &request.command.environment {
            command.args(["-e", &format!("{name}={value}")]);
        }
        for (key, value) in [
            ("remain-on-exit", "on"),
            ("window-size", "manual"),
            ("status", "off"),
            (OWNER_KEY, OWNER_VALUE),
            (RUN_KEY, request.identity.agent_run_id()),
            (NAMESPACE_KEY, request.identity.runtime_namespace()),
        ] {
            command.args([";", "set-option", "-t", &session, key, value]);
        }
        // Keep creation and ownership publication in one tmux command queue.
        // A concurrent reconciliation client can otherwise observe the new
        // session between `new-session` and the first `set-option` and treat
        // the incomplete identity as an orphan.
        checked(command, "create detached session")?;

        let mut start = self.command();
        start
            .args(["respawn-pane", "-k", "-t", &session, "--"])
            .arg(hosted.tmux_command());
        if let Err(error) = checked(start, "start hosted command") {
            let cleanup = checked(
                self.command_with(["kill-session", "-t", &session]),
                "remove partial session",
            );
            return match cleanup {
                Ok(_) => Err(error),
                Err(cleanup_error) => Err(TmuxAdapterError::Unavailable(format!(
                    "{error}; {cleanup_error}"
                ))),
            };
        }
        hosted.release_to_process();
        match self.observe(&request.identity) {
            RuntimeObservation::Running | RuntimeObservation::Exited { .. } => {
                Ok(CreateOutcome::Created)
            }
            value => Err(TmuxAdapterError::Unavailable(format!(
                "created session failed verification: {value:?}"
            ))),
        }
    }

    pub fn kill_verified(
        &self,
        identity: &RuntimeIdentity,
    ) -> Result<KillOutcome, TmuxAdapterError> {
        match self.observe(identity) {
            RuntimeObservation::Missing => Ok(KillOutcome::AlreadyMissing),
            RuntimeObservation::Running | RuntimeObservation::Exited { .. } => {
                let session = session_name(identity.agent_run_id());
                checked(
                    self.command_with(["kill-session", "-t", &session]),
                    "kill verified session",
                )?;
                Ok(KillOutcome::Killed)
            }
            value => Ok(KillOutcome::Refused(value)),
        }
    }

    /// Temporary profiles own their unique socket and may remove all verified
    /// Ticketry sessions when the profile itself is discarded. Any foreign or
    /// malformed entry refuses the cleanup.
    pub fn kill_all_verified(&self) -> Result<(), TmuxAdapterError> {
        let sessions = self.read_sessions()?;
        if sessions.iter().any(|row| !row.is_verified_owned()) {
            return Err(TmuxAdapterError::Unavailable(
                "temporary socket contains an unverified session".into(),
            ));
        }
        for row in sessions {
            let identity = RuntimeIdentity::new(&row.run_id, &row.namespace)?;
            match self.kill_verified(&identity)? {
                KillOutcome::Killed | KillOutcome::AlreadyMissing => {}
                KillOutcome::Refused(observation) => {
                    return Err(TmuxAdapterError::Unavailable(format!(
                        "temporary session cleanup was refused: {observation:?}"
                    )))
                }
            }
        }
        Ok(())
    }

    pub(crate) fn validate_run_id(run_id: &str) -> Result<(), TmuxAdapterError> {
        validate_identifier(run_id)
    }

    pub(crate) fn session_exists(&self, run_id: &str) -> Result<bool, TmuxAdapterError> {
        validate_identifier(run_id)?;
        let session = session_name(run_id);
        let output = self
            .command_with(["has-session", "-t", &session])
            .output()
            .map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))?;
        if output.status.success() {
            return Ok(true);
        }
        if String::from_utf8_lossy(&output.stderr).contains("can't find session") {
            return Ok(false);
        }
        Err(TmuxAdapterError::Unavailable(failure(
            "inspect session",
            &output,
        )))
    }

    pub(crate) fn capture_screen(&self, run_id: &str) -> Result<Vec<u8>, TmuxAdapterError> {
        validate_identifier(run_id)?;
        let session = session_name(run_id);
        let output = self
            .command_with(["capture-pane", "-p", "-t", &session])
            .output()
            .map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))?;
        if !output.status.success() {
            return Err(TmuxAdapterError::Unavailable(failure(
                "capture terminal screen",
                &output,
            )));
        }
        Ok(output.stdout)
    }

    pub(crate) fn resize(
        &self,
        run_id: &str,
        columns: u16,
        rows: u16,
    ) -> Result<(), TmuxAdapterError> {
        validate_geometry(columns, rows)?;
        let session = session_name(run_id);
        checked(
            self.command_with([
                "resize-window",
                "-t",
                &session,
                "-x",
                &columns.to_string(),
                "-y",
                &rows.to_string(),
            ]),
            "resize terminal",
        )?;
        Ok(())
    }

    pub(crate) fn scroll(
        &self,
        run_id: &str,
        direction: ScrollDirection,
        lines: u16,
    ) -> Result<(), TmuxAdapterError> {
        if !(1..=MAX_SCROLL_LINES).contains(&lines) {
            return Err(TmuxAdapterError::InvalidScrollLines { lines });
        }
        let session = session_name(run_id);
        checked(
            self.command_with(["copy-mode", "-e", "-H", "-t", &session]),
            "enter copy mode",
        )?;
        let action = match direction {
            ScrollDirection::Up => "scroll-up",
            ScrollDirection::Down => "scroll-down",
        };
        checked(
            self.command_with([
                "send-keys",
                "-t",
                &session,
                "-X",
                "-N",
                &lines.to_string(),
                action,
            ]),
            "scroll copy mode",
        )?;
        Ok(())
    }

    pub(crate) fn validate_input(input: &[u8]) -> Result<(), TmuxAdapterError> {
        if input.len() > MAX_INPUT_BYTES {
            Err(TmuxAdapterError::InputTooLarge { bytes: input.len() })
        } else {
            Ok(())
        }
    }

    pub(crate) fn attach_command(&self, run_id: &str) -> CommandBuilder {
        let mut command = CommandBuilder::new(&self.executable);
        command.args([
            "-L",
            &self.socket,
            "attach-session",
            "-t",
            &session_name(run_id),
        ]);
        command.env_remove("TMUX");
        if let Some(directory) = &self.socket_directory {
            command.env("TMUX_TMPDIR", directory);
        }
        command
    }

    pub(crate) fn attach_shell_command(
        &self,
        run_id: &str,
        renderer_environment: &[String],
    ) -> String {
        // POSIX `env` stops parsing options at the first NAME=VALUE operand.
        // Keep every unset option ahead of the renderer's assignments or the
        // macOS implementation tries to execute the later `-u` as a command.
        let mut environment = vec!["-u".to_owned(), "TMUX".to_owned()];
        environment.extend_from_slice(renderer_environment);
        if let Some(directory) = &self.socket_directory {
            environment.push(format!("TMUX_TMPDIR={}", directory.to_string_lossy()));
        }
        environment
            .iter()
            .map(|value| shell_quote(value))
            .chain([
                shell_quote(&self.executable.to_string_lossy()),
                shell_quote("-L"),
                shell_quote(&self.socket),
                shell_quote("attach-session"),
                shell_quote("-t"),
                shell_quote(&session_name(run_id)),
            ])
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn read_sessions(&self) -> Result<Vec<SessionRecord>, TmuxAdapterError> {
        let output = self.command_with(["list-sessions", "-F", "#{session_name}\t#{@pt-owner}\t#{@pt-agent-run-id}\t#{@pt-runtime-namespace}\t#{window_panes}\t#{pane_dead}\t#{pane_dead_status}"])
            .output().map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("no server running") || stderr.contains("No such file or directory")
            {
                return Ok(Vec::new());
            }
            return Err(TmuxAdapterError::Unavailable(failure(
                "inventory sessions",
                &output,
            )));
        }
        String::from_utf8(output.stdout)
            .map_err(|_| TmuxAdapterError::Unavailable("inventory was not UTF-8".into()))?
            .lines()
            .map(SessionRecord::parse)
            .collect()
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.executable);
        command
            .args(["-L", &self.socket])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command.env_remove("TMUX");
        // Finder launches GUI applications without a locale. In that mode tmux
        // sanitizes control characters in format strings, turning the tabs in
        // our inventory format into underscores and making valid rows
        // unparseable. Pin the client locale instead of depending on the
        // process that launched Ticketry.
        command.env_remove("LC_ALL");
        command.env("LC_CTYPE", "UTF-8");
        if let Some(directory) = &self.socket_directory {
            command.env("TMUX_TMPDIR", directory);
        }
        command
    }

    fn command_with<const N: usize>(&self, args: [&str; N]) -> Command {
        let mut command = self.command();
        command.args(args);
        command
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ScrollDirection {
    Up,
    Down,
}

pub(crate) fn approved_tool_path(tool: SupportedTool) -> Result<PathBuf, TmuxAdapterError> {
    let item = preflight_report()
        .tools
        .into_iter()
        .find(|item| item.tool == tool)
        .ok_or_else(|| TmuxAdapterError::Unavailable("tool discovery returned no result".into()))?;
    if item.health != ToolHealth::Ready {
        return Err(TmuxAdapterError::Unavailable(
            item.guidance
                .unwrap_or_else(|| "approved executable was not found".into()),
        ));
    }
    item.path
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| {
            TmuxAdapterError::Unavailable("approved executable has no absolute path".into())
        })
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn checked(mut command: Command, operation: &str) -> Result<Output, TmuxAdapterError> {
    let output = command
        .output()
        .map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(TmuxAdapterError::Unavailable(failure(operation, &output)))
    }
}

fn failure(operation: &str, output: &Output) -> String {
    let detail = String::from_utf8_lossy(&output.stderr)
        .trim()
        .chars()
        .take(240)
        .collect::<String>();
    if detail.is_empty() {
        format!("tmux could not {operation}")
    } else {
        format!("tmux could not {operation}: {detail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_structured_values() {
        assert!(RuntimeIdentity::new("run-123", "desktop").is_ok());
        assert!(RuntimeIdentity::new("run;kill", "desktop").is_err());
        assert!(TerminalGeometry::new(0, 24).is_err());
        assert_eq!(session_name("run-123"), "pt-run-123");
    }

    #[test]
    fn parses_exit_state() {
        let row = SessionRecord::parse("pt-run\tticketry-v1\trun\tns\t1\t1\t17").unwrap();
        assert!(row.pane_dead);
        assert_eq!(row.exit_code, Some(17));
    }

    #[test]
    fn puts_every_env_unset_before_renderer_assignments() {
        let adapter = TmuxAdapter {
            executable: PathBuf::from("/approved/tmux"),
            socket: "ticketry-dev".to_owned(),
            socket_directory: Some(OsString::from("/tmp/tmux")),
        };
        let command = adapter.attach_shell_command(
            "run-123",
            &[
                "-u".to_owned(),
                "LC_ALL".to_owned(),
                "TERM=xterm-256color".to_owned(),
                "LC_CTYPE=UTF-8".to_owned(),
            ],
        );

        assert_eq!(
            command,
            "'-u' 'TMUX' '-u' 'LC_ALL' 'TERM=xterm-256color' 'LC_CTYPE=UTF-8' 'TMUX_TMPDIR=/tmp/tmux' '/approved/tmux' '-L' 'ticketry-dev' 'attach-session' '-t' 'pt-run-123'",
        );
    }

    #[test]
    fn tmux_commands_pin_utf8_for_inventory_delimiters() {
        let adapter = TmuxAdapter {
            executable: PathBuf::from("/approved/tmux"),
            socket: "ticketry-dev".to_owned(),
            socket_directory: None,
        };
        let command = adapter.command();
        let environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<std::collections::BTreeMap<_, _>>();

        assert_eq!(environment.get("LC_ALL"), Some(&None));
        assert_eq!(environment.get("LC_CTYPE"), Some(&Some("UTF-8".to_owned())));
    }
}
