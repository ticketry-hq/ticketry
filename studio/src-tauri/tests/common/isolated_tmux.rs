//! Isolated tmux server harness for terminal attachment integration tests.
//!
//! Each test owns a private tmux server, socket directory, and environment so
//! attachment, scroll, and detach behaviour is observed without touching a
//! developer's own sessions.
//!
//! Shared by several integration binaries, so not every helper is used by all.
#![allow(dead_code)]

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use ticketry_tool_discovery::{preflight_report, SupportedTool, ToolHealth};

pub const SOCKET: &str = "muxed";
pub const RUN_ID: &str = "integration-run";

pub static TMUX_ENV_LOCK: Mutex<()> = Mutex::new(());

pub struct TmuxEnvironmentOverride {
    previous_tmpdir: Option<std::ffi::OsString>,
    previous_tmux: Option<std::ffi::OsString>,
    previous_term: Option<std::ffi::OsString>,
    previous_terminfo: Option<std::ffi::OsString>,
    previous_data_dir: Option<std::ffi::OsString>,
    previous_socket: Option<std::ffi::OsString>,
}

impl TmuxEnvironmentOverride {
    pub fn set(path: &Path) -> Self {
        Self::set_with_data_directory(path, &path.join("data"))
    }

    pub fn set_with_data_directory(path: &Path, data_directory: &Path) -> Self {
        let previous_tmpdir = env::var_os("TMUX_TMPDIR");
        let previous_tmux = env::var_os("TMUX");
        let previous_term = env::var_os("TERM");
        let previous_terminfo = env::var_os("TERMINFO");
        let previous_data_dir = env::var_os("MUXED_DATA_DIR");
        let previous_socket = env::var_os("MUXED_TMUX_SOCKET");
        env::set_var("TMUX_TMPDIR", path);
        env::remove_var("TMUX");
        env::set_var("TERM", "xterm-256color");
        env::remove_var("TERMINFO");
        env::set_var("MUXED_DATA_DIR", data_directory);
        env::set_var("MUXED_TMUX_SOCKET", SOCKET);
        Self {
            previous_tmpdir,
            previous_tmux,
            previous_term,
            previous_terminfo,
            previous_data_dir,
            previous_socket,
        }
    }
}

impl Drop for TmuxEnvironmentOverride {
    fn drop(&mut self) {
        match self.previous_tmpdir.take() {
            Some(value) => env::set_var("TMUX_TMPDIR", value),
            None => env::remove_var("TMUX_TMPDIR"),
        }
        match self.previous_tmux.take() {
            Some(value) => env::set_var("TMUX", value),
            None => env::remove_var("TMUX"),
        }
        match self.previous_term.take() {
            Some(value) => env::set_var("TERM", value),
            None => env::remove_var("TERM"),
        }
        match self.previous_terminfo.take() {
            Some(value) => env::set_var("TERMINFO", value),
            None => env::remove_var("TERMINFO"),
        }
        match self.previous_data_dir.take() {
            Some(value) => env::set_var("MUXED_DATA_DIR", value),
            None => env::remove_var("MUXED_DATA_DIR"),
        }
        match self.previous_socket.take() {
            Some(value) => env::set_var("MUXED_TMUX_SOCKET", value),
            None => env::remove_var("MUXED_TMUX_SOCKET"),
        }
    }
}

pub struct IsolatedTmux {
    executable: PathBuf,
    pub socket_dir: PathBuf,
}

impl IsolatedTmux {
    pub fn start() -> Self {
        let server = Self::start_empty();
        server.create_hosted(RUN_ID, "exec /bin/sh");
        server
    }

    pub fn start_empty() -> Self {
        let executable = tmux_path();
        // tmux's Unix-domain socket has a small platform path limit. Keep the
        // isolated directory short even when the system temporary directory is
        // a long per-user macOS path.
        let socket_dir = PathBuf::from("/private/tmp").join(format!(
            "mx-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock is after epoch")
                .as_nanos()
        ));
        fs::create_dir(&socket_dir).expect("create isolated tmux socket directory");
        Self {
            executable,
            socket_dir,
        }
    }

    pub fn create_hosted(&self, agent_run_id: &str, command: &str) {
        let session = format!("pt-{agent_run_id}");
        let mut create = Command::new(&self.executable);
        create
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .current_dir(&self.socket_dir)
            .args(["-L", SOCKET, "-f", "/dev/null", "new-session", "-d", "-s"])
            .arg(&session)
            .arg("while :; do sleep 1; done");
        for (key, value) in [
            ("remain-on-exit", "on"),
            ("window-size", "manual"),
            ("status", "off"),
            ("@pt-owner", "ticketry-v1"),
            ("@pt-agent-run-id", agent_run_id),
            ("@pt-runtime-namespace", "tmux-characterization"),
        ] {
            create.args([";", "set-option", "-t", &session, key, value]);
        }
        let output = create
            .stdin(Stdio::null())
            .output()
            .expect("create isolated hosted command");
        assert!(
            output.status.success(),
            "tmux hosted-command setup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .current_dir(&self.socket_dir)
            .args(["-L", SOCKET, "respawn-pane", "-k", "-t"])
            .arg(&session)
            .arg(command)
            .stdin(Stdio::null())
            .output()
            .expect("start isolated hosted command");
        assert!(
            output.status.success(),
            "tmux hosted command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    pub fn inventory(&self) -> Vec<(String, String)> {
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args([
                "-L",
                SOCKET,
                "list-sessions",
                "-F",
                "#{session_name}|#{@pt-agent-run-id}",
            ])
            .stdin(Stdio::null())
            .output()
            .expect("inventory isolated tmux server");
        if !output.status.success() {
            return Vec::new();
        }
        let mut inventory = String::from_utf8(output.stdout)
            .expect("tmux inventory is UTF-8")
            .lines()
            .map(|line| {
                let (name, identity) = line.split_once('|').expect("tmux inventory delimiter");
                (name.to_owned(), identity.to_owned())
            })
            .collect::<Vec<_>>();
        inventory.sort();
        inventory
    }

    pub fn hosted_exit_code(&self, agent_run_id: &str) -> Option<i32> {
        let session = format!("pt-{agent_run_id}:0.0");
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args([
                "-L",
                SOCKET,
                "display-message",
                "-p",
                "-t",
                &session,
                "#{pane_dead}|#{pane_dead_status}",
            ])
            .stdin(Stdio::null())
            .output()
            .expect("inspect isolated hosted command");
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8(output.stdout).expect("tmux pane state is UTF-8");
        let (dead, code) = value
            .trim()
            .split_once('|')
            .expect("tmux pane-state delimiter");
        (dead == "1").then(|| code.parse().expect("numeric hosted-command exit code"))
    }

    /// End one hosted runtime the way a finished agent does, leaving the
    /// private server and every other session in place.
    pub fn kill_agent_run(&self, agent_run_id: &str) {
        let session = format!("pt-{agent_run_id}");
        let _ = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args(["-L", SOCKET, "kill-session", "-t", &session])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    pub fn set_session_option(&self, agent_run_id: &str, key: &str, value: &str) {
        let session = format!("pt-{agent_run_id}");
        self.command(["set-option", "-t", &session, key, value]);
    }

    pub fn add_window(&self, agent_run_id: &str) {
        let session = format!("pt-{agent_run_id}");
        self.command(["split-window", "-d", "-t", &session]);
    }

    pub fn stop_server(&self) {
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args(["-L", SOCKET, "kill-server"])
            .stdin(Stdio::null())
            .output()
            .expect("stop isolated tmux server");
        assert!(
            output.status.success(),
            "tmux server stop failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    pub fn has_session(&self) -> bool {
        self.has_agent_run(RUN_ID)
    }

    pub fn has_agent_run(&self, agent_run_id: &str) -> bool {
        let session = format!("pt-{agent_run_id}");
        Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args(["-L", SOCKET, "has-session", "-t", &session])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("query isolated tmux server")
            .success()
    }

    pub fn window_size(&self) -> String {
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args([
                "-L",
                SOCKET,
                "display-message",
                "-p",
                "-t",
                "pt-integration-run:0",
                "#{window_width}x#{window_height}",
            ])
            .stdin(Stdio::null())
            .output()
            .expect("query isolated tmux window size");
        assert!(
            output.status.success(),
            "tmux window-size query failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("tmux window size is UTF-8")
            .trim()
            .to_owned()
    }

    pub fn pane_value(&self, format: &str) -> String {
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args([
                "-L",
                SOCKET,
                "display-message",
                "-p",
                "-t",
                "pt-integration-run:0.0",
                format,
            ])
            .stdin(Stdio::null())
            .output()
            .expect("query isolated tmux pane");
        assert!(
            output.status.success(),
            "tmux pane query failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("tmux pane value is UTF-8")
            .trim()
            .to_owned()
    }

    pub fn pane_contents(&self, agent_run_id: &str) -> String {
        let target = format!("pt-{agent_run_id}");
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args(["-L", SOCKET, "capture-pane", "-p", "-J", "-t", &target])
            .stdin(Stdio::null())
            .output()
            .expect("capture isolated tmux pane");
        assert!(
            output.status.success(),
            "tmux pane capture failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).expect("tmux pane is UTF-8")
    }

    pub fn global_option(&self, option: &str) -> String {
        let output = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args(["-L", SOCKET, "show-options", "-g", "-v", option])
            .stdin(Stdio::null())
            .output()
            .expect("query isolated tmux session option");
        assert!(
            output.status.success(),
            "tmux option query failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("tmux option value is UTF-8")
            .trim()
            .to_owned()
    }

    pub fn set_window_option(&self, option: &str, value: &str) {
        run_tmux(
            &self.executable,
            &self.socket_dir,
            [
                "set-option",
                "-w",
                "-t",
                "pt-integration-run",
                option,
                value,
            ],
        );
    }

    fn command<const N: usize>(&self, arguments: [&str; N]) {
        run_tmux(&self.executable, &self.socket_dir, arguments);
    }
}

impl Drop for IsolatedTmux {
    fn drop(&mut self) {
        let _ = Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args(["-L", SOCKET, "kill-server"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = fs::remove_dir_all(&self.socket_dir);
    }
}

pub fn tmux_path() -> PathBuf {
    let diagnostic = preflight_report()
        .tools
        .into_iter()
        .find(|tool| tool.tool == SupportedTool::Tmux)
        .expect("tmux diagnostic");
    assert_eq!(
        diagnostic.health,
        ToolHealth::Ready,
        "{:?}",
        diagnostic.guidance
    );
    PathBuf::from(diagnostic.path.expect("approved tmux path"))
}

pub fn run_tmux<const N: usize>(executable: &Path, socket_dir: &Path, arguments: [&str; N]) {
    let output = Command::new(executable)
        .env("TMUX_TMPDIR", socket_dir)
        .env_remove("TMUX")
        .current_dir(socket_dir)
        .args(["-L", SOCKET])
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .expect("start isolated tmux server");
    assert!(
        output.status.success(),
        "tmux test setup failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
