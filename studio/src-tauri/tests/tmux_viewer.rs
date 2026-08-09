use muxed_studio_lib::discovery::{preflight_report, SupportedTool, ToolHealth};
use muxed_studio_lib::terminal_runtime::{
    AttachmentOutcome, TerminalAttachment, TerminalAttachmentError, TerminalScrollDirection,
};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SOCKET: &str = "muxed";
const RUN_ID: &str = "integration-run";

static TMUX_ENV_LOCK: Mutex<()> = Mutex::new(());

struct TmuxEnvironmentOverride {
    previous_tmpdir: Option<std::ffi::OsString>,
    previous_tmux: Option<std::ffi::OsString>,
    previous_term: Option<std::ffi::OsString>,
    previous_terminfo: Option<std::ffi::OsString>,
    previous_data_dir: Option<std::ffi::OsString>,
    previous_socket: Option<std::ffi::OsString>,
}

impl TmuxEnvironmentOverride {
    fn set(path: &Path) -> Self {
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
        env::set_var("MUXED_DATA_DIR", path.join("data"));
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

struct IsolatedTmux {
    executable: PathBuf,
    socket_dir: PathBuf,
}

impl IsolatedTmux {
    fn start() -> Self {
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
        run_tmux(
            &executable,
            &socket_dir,
            [
                "-f",
                "/dev/null",
                "new-session",
                "-d",
                "-s",
                "pt-integration-run",
            ],
        );
        run_tmux(
            &executable,
            &socket_dir,
            [
                "set-option",
                "-t",
                "pt-integration-run",
                "window-size",
                "manual",
            ],
        );
        Self {
            executable,
            socket_dir,
        }
    }

    fn has_session(&self) -> bool {
        Command::new(&self.executable)
            .env("TMUX_TMPDIR", &self.socket_dir)
            .env_remove("TMUX")
            .args(["-L", SOCKET, "has-session", "-t", "pt-integration-run"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("query isolated tmux server")
            .success()
    }

    fn window_size(&self) -> String {
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

    fn pane_value(&self, format: &str) -> String {
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

    fn global_option(&self, option: &str) -> String {
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

    fn set_window_option(&self, option: &str, value: &str) {
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

#[test]
fn attaches_exchanges_input_resizes_and_detaches_without_killing_the_session() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);

    let viewer = TerminalAttachment::attach(RUN_ID, 91, 27).expect("attach terminal");
    let (mut viewer, mut reader) = viewer.into_control_and_reader();
    assert_eq!(server.window_size(), "91x27");
    assert_eq!(viewer.poll_exit().expect("poll attached client"), None);

    viewer.resize(120, 40).expect("resize viewer PTY");
    assert_eq!(server.window_size(), "120x40");
    assert_eq!(viewer.poll_exit().expect("poll resized client"), None);

    viewer
        .write_all(b"printf 'MUXED_PTY_OK\\n'\\r")
        .expect("write deterministic input");

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let viewer = viewer;
        let mut output = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(read) => {
                    output.extend_from_slice(&buffer[..read]);
                    if output
                        .windows(b"MUXED_PTY_OK".len())
                        .any(|bytes| bytes == b"MUXED_PTY_OK")
                    {
                        sender.send(Ok((viewer, output))).expect("return viewer");
                        return;
                    }
                }
                Err(error) => {
                    sender
                        .send(Err(error.to_string()))
                        .expect("return read error");
                    return;
                }
            }
        }
    });
    let (viewer, output) = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("tmux produced deterministic output")
        .expect("PTY did not close before output");
    assert!(String::from_utf8_lossy(&output).contains("MUXED_PTY_OK"));
    assert_eq!(
        viewer.detach().expect("detach viewer"),
        AttachmentOutcome::Detached
    );
    assert!(
        server.has_session(),
        "detach must not kill the durable tmux session"
    );
}

#[test]
fn reports_a_missing_session_as_a_typed_error() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);

    let error = match TerminalAttachment::attach("missing-run", 80, 24) {
        Err(error) => error,
        Ok(_) => panic!("missing session must fail"),
    };
    assert!(matches!(
        error,
        TerminalAttachmentError::SessionNotFound { .. }
    ));
}

#[test]
fn scrolls_copy_mode_history_back_to_the_live_prompt_without_ending_the_session() {
    let _environment_lock = TMUX_ENV_LOCK.lock().expect("lock TMUX_TMPDIR");
    let server = IsolatedTmux::start();
    let _environment = TmuxEnvironmentOverride::set(&server.socket_dir);
    let viewer = TerminalAttachment::attach(RUN_ID, 80, 12).expect("attach terminal");
    let (mut viewer, mut reader) = viewer.into_control_and_reader();
    let (output_sender, output_receiver) = mpsc::channel();
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(read) => {
                    if output_sender.send(buffer[..read].to_vec()).is_err() {
                        return;
                    }
                }
            }
        }
    });

    viewer
        .write_all(
            b"i=1; while [ $i -le 80 ]; do printf 'SCROLL_%03d\\n' \"$i\"; i=$((i+1)); done\r",
        )
        .expect("populate deterministic scrollback");
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while server
        .pane_value("#{history_size}")
        .parse::<usize>()
        .expect("numeric tmux history size")
        < 40
    {
        assert!(
            std::time::Instant::now() < deadline,
            "tmux did not populate scrollback"
        );
        thread::sleep(Duration::from_millis(20));
    }

    const MARKER: &[u8] = b"POSMARK";
    server.set_window_option(
        "copy-mode-position-format",
        std::str::from_utf8(MARKER).expect("ASCII marker"),
    );
    while output_receiver.try_recv().is_ok() {}

    viewer
        .scroll(TerminalScrollDirection::Up, 6)
        .expect("scroll upward");
    assert_eq!(server.pane_value("#{pane_in_mode}"), "1");
    assert!(
        server
            .pane_value("#{scroll_position}")
            .parse::<usize>()
            .expect("numeric scroll position")
            >= 6
    );
    let output_deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut rendered = Vec::new();
    while std::time::Instant::now() < output_deadline {
        match output_receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => rendered.extend_from_slice(&chunk),
            Err(mpsc::RecvTimeoutError::Timeout) if !rendered.is_empty() => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    assert!(
        rendered
            .windows(b"SCROLL_".len())
            .any(|bytes| bytes == b"SCROLL_"),
        "copy-mode should redraw terminal history"
    );
    assert!(
        !rendered.windows(MARKER.len()).any(|bytes| bytes == MARKER),
        "copy-mode position marker must be hidden"
    );

    viewer
        .scroll(TerminalScrollDirection::Down, 500)
        .expect("scroll to live prompt");
    assert_eq!(server.pane_value("#{pane_in_mode}"), "0");
    assert_eq!(server.global_option("mouse"), "off");
    assert!(
        server.has_session(),
        "scrolling must preserve the durable session"
    );

    assert_eq!(
        viewer.detach().expect("detach scrolled viewer"),
        AttachmentOutcome::Detached
    );
    reader_thread.join().expect("join viewer output reader");
    assert!(
        server.has_session(),
        "detach must preserve the durable session"
    );
}

fn tmux_path() -> PathBuf {
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

fn run_tmux<const N: usize>(executable: &Path, socket_dir: &Path, arguments: [&str; N]) {
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
