//! macOS libghostty surface hosted above the Tauri webview.
//!
//! libghostty still owns the renderer-facing PTY. A tiny child mode in this
//! executable bridges that PTY byte-for-byte to a transport-independent
//! terminal attachment, so tmux remains the durable session owner while its
//! executable, socket, session naming, and PTY mechanics stay private.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    not(all(target_os = "macos", feature = "native-libghostty")),
    allow(dead_code)
)]
pub struct NativeTerminalFrame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}

#[cfg(all(target_os = "macos", feature = "native-libghostty"))]
mod imp {
    use super::NativeTerminalFrame;
    use crate::terminal_runtime::TerminalAttachment;
    use rand::Rng;
    use serde::Serialize;
    use std::collections::HashMap;
    use std::ffi::{c_char, c_void, CString};
    use std::fs;
    use std::io::{self, Read, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::Emitter;

    const INITIAL_COLUMNS: u16 = 80;
    const INITIAL_ROWS: u16 = 24;
    const MAX_INPUT_BYTES: usize = 64 * 1024;

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct GhosttyGridSize {
        columns: u16,
        rows: u16,
    }

    unsafe extern "C" {
        fn muxed_ghostty_runtime_new() -> *mut c_void;
        fn muxed_ghostty_runtime_free(runtime: *mut c_void);
        fn muxed_ghostty_view_new(
            runtime: *mut c_void,
            parent_view: *mut c_void,
            command: *const c_char,
        ) -> *mut c_void;
        fn muxed_ghostty_view_free(view: *mut c_void);
        fn muxed_ghostty_view_set_frame(
            view: *mut c_void,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            viewport_width: f64,
            viewport_height: f64,
        ) -> GhosttyGridSize;
        fn muxed_ghostty_view_focus(view: *mut c_void);
    }

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct NativeTerminalStatus {
        handle: String,
        run_id: String,
        columns: u16,
        rows: u16,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NativeTerminalFailure {
        handle: String,
        run_id: String,
        reason: String,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NativeTerminalCompletion {
        handle: String,
        run_id: String,
        reason: String,
    }

    pub struct NativeTerminalState {
        runtime: Mutex<Option<usize>>,
        entries: Arc<Mutex<HashMap<String, NativeEntry>>>,
    }

    struct NativeEntry {
        run_id: String,
        view: usize,
        worker: mpsc::Sender<WorkerCommand>,
        socket_path: PathBuf,
    }

    enum WorkerCommand {
        Input(Vec<u8>),
        Resize(u16, u16),
        Detach,
        BridgeFailed,
    }

    struct WorkerSetup {
        attachment: TerminalAttachment,
        bridge: UnixStream,
        output: UnixStream,
        command_sender: mpsc::Sender<WorkerCommand>,
        commands: Receiver<WorkerCommand>,
        socket_path: PathBuf,
        window: tauri::WebviewWindow,
        entries: Arc<Mutex<HashMap<String, NativeEntry>>>,
        handle: String,
        run_id: String,
    }

    // All Objective-C pointers are created and consumed on AppKit's main
    // thread. They cross command threads only as inert integer handles.
    unsafe impl Send for NativeTerminalState {}
    unsafe impl Sync for NativeTerminalState {}

    impl Default for NativeTerminalState {
        fn default() -> Self {
            Self::new()
        }
    }

    impl NativeTerminalState {
        pub fn new() -> Self {
            Self {
                runtime: Mutex::new(None),
                entries: Arc::new(Mutex::new(HashMap::new())),
            }
        }

        pub fn detach_all(&self) {
            let entries = {
                let mut registry = self
                    .entries
                    .lock()
                    .expect("native terminal registry poisoned");
                registry.drain().map(|(_, entry)| entry).collect::<Vec<_>>()
            };
            for entry in entries {
                unsafe { muxed_ghostty_view_free(entry.view as *mut c_void) };
                let _ = entry.worker.send(WorkerCommand::Detach);
                let _ = fs::remove_file(entry.socket_path);
            }
            if let Some(runtime) = self
                .runtime
                .lock()
                .expect("ghostty runtime poisoned")
                .take()
            {
                unsafe { muxed_ghostty_runtime_free(runtime as *mut c_void) };
            }
        }
    }

    #[tauri::command]
    pub fn native_terminal_available() -> bool {
        true
    }

    #[tauri::command]
    pub fn native_terminal_attach(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, NativeTerminalState>,
        run_id: String,
    ) -> Result<NativeTerminalStatus, String> {
        if window.label() != "main" {
            return Err("native terminals are restricted to the main window".to_owned());
        }
        if state
            .entries
            .lock()
            .expect("native terminal registry poisoned")
            .values()
            .any(|entry| entry.run_id == run_id)
        {
            return Err("a native viewer is already attached to this run".to_owned());
        }

        let attachment = TerminalAttachment::attach(&run_id, INITIAL_COLUMNS, INITIAL_ROWS)
            .map_err(|error| error.to_string())?;
        let handle = new_handle();
        let socket_path = socket_path(&handle);
        let mut created_view = None;
        let setup = (|| -> Result<(usize, UnixStream, UnixStream), String> {
            let listener = UnixListener::bind(&socket_path)
                .map_err(|error| format!("could not create libghostty bridge: {error}"))?;
            fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("could not protect libghostty bridge: {error}"))?;

            let executable = std::env::current_exe()
                .map_err(|error| format!("could not locate desktop executable: {error}"))?;
            let command = CString::new(format!(
                "{} --muxed-ghostty-bridge {}",
                shell_quote(&executable.to_string_lossy()),
                shell_quote(&socket_path.to_string_lossy())
            ))
            .map_err(|_| "libghostty bridge command contained a NUL byte".to_owned())?;
            let parent = window.ns_view().map_err(|error| error.to_string())? as usize;

            let runtime = ensure_runtime(&window, &state)?;
            let (view_sender, view_receiver) = mpsc::channel();
            let command_bytes = command.into_bytes_with_nul();
            window
                .run_on_main_thread(move || {
                    let view = unsafe {
                        muxed_ghostty_view_new(
                            runtime as *mut c_void,
                            parent as *mut c_void,
                            command_bytes.as_ptr().cast(),
                        )
                    };
                    if view_sender.send(view as usize).is_err() && !view.is_null() {
                        unsafe { muxed_ghostty_view_free(view) };
                    }
                })
                .map_err(|error| error.to_string())?;
            let view = view_receiver
                .recv_timeout(Duration::from_secs(5))
                .map_err(|_| "timed out creating the native libghostty view".to_owned())?;
            if view == 0 {
                return Err("libghostty could not create its native surface".to_owned());
            }
            created_view = Some(view);
            let bridge = accept_bridge(&listener)?;
            let output = bridge
                .try_clone()
                .map_err(|error| format!("could not clone libghostty bridge: {error}"))?;
            Ok((view, bridge, output))
        })();
        let (view, bridge, output) = match setup {
            Ok(setup) => setup,
            Err(error) => {
                if let Some(view) = created_view {
                    let _ = window.run_on_main_thread(move || unsafe {
                        muxed_ghostty_view_free(view as *mut c_void);
                    });
                }
                let _ = fs::remove_file(&socket_path);
                let _ = attachment.detach();
                return Err(error);
            }
        };
        let (worker, commands) = mpsc::channel();
        state
            .entries
            .lock()
            .expect("native terminal registry poisoned")
            .insert(
                handle.clone(),
                NativeEntry {
                    run_id: run_id.clone(),
                    view,
                    worker: worker.clone(),
                    socket_path: socket_path.clone(),
                },
            );
        spawn_worker(WorkerSetup {
            attachment,
            bridge,
            output,
            command_sender: worker,
            commands,
            socket_path,
            window: window.clone(),
            entries: Arc::clone(&state.entries),
            handle: handle.clone(),
            run_id: run_id.clone(),
        });

        Ok(NativeTerminalStatus {
            handle,
            run_id,
            columns: INITIAL_COLUMNS,
            rows: INITIAL_ROWS,
        })
    }

    #[tauri::command]
    pub fn native_terminal_set_frame(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, NativeTerminalState>,
        handle: String,
        frame: NativeTerminalFrame,
    ) -> Result<NativeTerminalStatus, String> {
        let NativeTerminalFrame {
            x,
            y,
            width,
            height,
            viewport_width,
            viewport_height,
        } = frame;
        validate_frame(x, y, width, height, viewport_width, viewport_height)?;
        let (view, run_id, worker) = {
            let registry = state
                .entries
                .lock()
                .expect("native terminal registry poisoned");
            let entry = registry
                .get(&handle)
                .ok_or_else(|| "native terminal handle was not found".to_owned())?;
            (entry.view, entry.run_id.clone(), entry.worker.clone())
        };
        let (size_sender, size_receiver) = mpsc::channel();
        window
            .run_on_main_thread(move || {
                let size = unsafe {
                    muxed_ghostty_view_set_frame(
                        view as *mut c_void,
                        x,
                        y,
                        width,
                        height,
                        viewport_width,
                        viewport_height,
                    )
                };
                let _ = size_sender.send(size);
            })
            .map_err(|error| error.to_string())?;
        let size = size_receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "timed out resizing the native libghostty view".to_owned())?;
        if size.columns > 0 && size.rows > 0 {
            let _ = worker.send(WorkerCommand::Resize(size.columns, size.rows));
        }
        Ok(NativeTerminalStatus {
            handle,
            run_id,
            columns: size.columns,
            rows: size.rows,
        })
    }

    #[tauri::command]
    pub fn native_terminal_focus(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, NativeTerminalState>,
        handle: String,
    ) -> Result<(), String> {
        let view = state
            .entries
            .lock()
            .expect("native terminal registry poisoned")
            .get(&handle)
            .map(|entry| entry.view)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        window
            .run_on_main_thread(move || unsafe {
                muxed_ghostty_view_focus(view as *mut c_void);
            })
            .map_err(|error| error.to_string())
    }

    #[tauri::command]
    pub fn native_terminal_detach(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, NativeTerminalState>,
        handle: String,
    ) -> Result<(), String> {
        let entry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned")
            .remove(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        let _ = entry.worker.send(WorkerCommand::Detach);
        let view = entry.view;
        window
            .run_on_main_thread(move || unsafe {
                muxed_ghostty_view_free(view as *mut c_void);
            })
            .map_err(|error| error.to_string())?;
        let _ = fs::remove_file(entry.socket_path);
        Ok(())
    }

    fn ensure_runtime(
        window: &tauri::WebviewWindow,
        state: &tauri::State<'_, NativeTerminalState>,
    ) -> Result<usize, String> {
        let mut slot = state.runtime.lock().expect("ghostty runtime poisoned");
        if let Some(runtime) = *slot {
            return Ok(runtime);
        }
        let (sender, receiver) = mpsc::channel();
        window
            .run_on_main_thread(move || {
                let runtime = unsafe { muxed_ghostty_runtime_new() };
                if sender.send(runtime as usize).is_err() && !runtime.is_null() {
                    unsafe { muxed_ghostty_runtime_free(runtime) };
                }
            })
            .map_err(|error| error.to_string())?;
        let runtime = receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "timed out initializing libghostty".to_owned())?;
        if runtime == 0 {
            return Err("libghostty initialization failed".to_owned());
        }
        *slot = Some(runtime);
        Ok(runtime)
    }

    fn accept_bridge(listener: &UnixListener) -> Result<UnixStream, String> {
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("could not configure libghostty bridge: {error}"))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match listener.accept() {
                Ok((bridge, _)) => return Ok(bridge),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err("timed out connecting the libghostty bridge".to_owned());
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => {
                    return Err(format!("could not accept libghostty bridge: {error}"));
                }
            }
        }
    }

    fn spawn_worker(setup: WorkerSetup) {
        let WorkerSetup {
            attachment,
            bridge,
            output,
            command_sender,
            commands,
            socket_path,
            window,
            entries,
            handle,
            run_id,
        } = setup;
        let (control, reader) = attachment.into_control_and_reader();
        start_bridge_pumps(bridge, output, reader, command_sender);
        thread::spawn(move || {
            let mut control = Some(control);
            loop {
                match commands.recv_timeout(Duration::from_millis(50)) {
                    Ok(WorkerCommand::Input(bytes)) => {
                        if bytes.len() <= MAX_INPUT_BYTES {
                            let _ = control
                                .as_mut()
                                .expect("attached native viewer has control")
                                .write_all(&bytes);
                        }
                    }
                    Ok(WorkerCommand::Resize(columns, rows)) => {
                        let _ = control
                            .as_ref()
                            .expect("attached native viewer has control")
                            .resize(columns, rows);
                    }
                    Ok(WorkerCommand::Detach) => {
                        let _ = control
                            .take()
                            .expect("attached native viewer has control")
                            .detach();
                        break;
                    }
                    Ok(WorkerCommand::BridgeFailed) => {
                        let _ = window.emit(
                            "native-terminal-failed",
                            NativeTerminalFailure {
                                handle: handle.clone(),
                                run_id: run_id.clone(),
                                reason: "the native terminal bridge disconnected".to_owned(),
                            },
                        );
                        let _ = control
                            .take()
                            .expect("attached native viewer has control")
                            .detach();
                        break;
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if let Some(viewer) = control.as_mut() {
                            if viewer.poll_exit().ok().flatten().is_some() {
                                control.take();
                                close_worker_entry(&entries, &window, &handle);
                                let _ = window.emit(
                                    "native-terminal-closed",
                                    NativeTerminalCompletion {
                                        handle: handle.clone(),
                                        run_id: run_id.clone(),
                                        reason: "attachment_process_exited".to_owned(),
                                    },
                                );
                                break;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            let _ = fs::remove_file(socket_path);
        });
    }

    fn take_native_entry(
        entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
        handle: &str,
    ) -> Option<NativeEntry> {
        entries
            .lock()
            .expect("native terminal registry poisoned")
            .remove(handle)
    }

    fn close_worker_entry(
        entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
        window: &tauri::WebviewWindow,
        handle: &str,
    ) {
        let Some(entry) = take_native_entry(entries, handle) else {
            return;
        };
        let view = entry.view;
        let _ = window.run_on_main_thread(move || unsafe {
            muxed_ghostty_view_free(view as *mut c_void);
        });
        let _ = fs::remove_file(entry.socket_path);
    }

    fn start_bridge_pumps(
        bridge: UnixStream,
        mut output: UnixStream,
        mut viewer_reader: Box<dyn Read + Send>,
        commands: mpsc::Sender<WorkerCommand>,
    ) {
        let output_commands = commands.clone();
        thread::spawn(move || {
            let _ = io::copy(&mut viewer_reader, &mut output);
            let _ = output_commands.send(WorkerCommand::BridgeFailed);
        });
        thread::spawn(move || {
            let mut input = bridge;
            let mut buffer = vec![0_u8; 8 * 1024];
            loop {
                match input.read(&mut buffer) {
                    Ok(0) | Err(_) => {
                        let _ = commands.send(WorkerCommand::BridgeFailed);
                        break;
                    }
                    Ok(read) => {
                        if commands
                            .send(WorkerCommand::Input(buffer[..read].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });
    }

    fn new_handle() -> String {
        format!("native-{:032x}", rand::thread_rng().gen::<u128>())
    }

    fn socket_path(handle: &str) -> PathBuf {
        PathBuf::from("/tmp").join(format!("muxed-{}-{}.sock", std::process::id(), handle))
    }

    fn shell_quote(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }

    fn validate_frame(
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        viewport_width: f64,
        viewport_height: f64,
    ) -> Result<(), String> {
        let values = [x, y, width, height, viewport_width, viewport_height];
        if values.iter().any(|value| !value.is_finite())
            || x < 0.0
            || y < 0.0
            || width <= 0.0
            || height <= 0.0
            || viewport_width <= 0.0
            || viewport_height <= 0.0
            || x + width > viewport_width + 1.0
            || y + height > viewport_height + 1.0
        {
            return Err("native terminal frame is invalid".to_owned());
        }
        Ok(())
    }

    pub fn run_bridge(path: &Path) -> io::Result<()> {
        set_stdin_raw();
        let bridge = UnixStream::connect(path)?;
        let mut output_bridge = bridge.try_clone()?;
        let stdout_thread = thread::spawn(move || {
            let mut stdout = io::stdout().lock();
            let _ = io::copy(&mut output_bridge, &mut stdout);
            let _ = stdout.flush();
        });
        let mut input_bridge = bridge;
        let mut stdin = io::stdin().lock();
        let _ = io::copy(&mut stdin, &mut input_bridge);
        let _ = input_bridge.shutdown(std::net::Shutdown::Write);
        let _ = stdout_thread.join();
        Ok(())
    }

    fn set_stdin_raw() {
        unsafe {
            let mut termios = std::mem::zeroed();
            if libc::tcgetattr(libc::STDIN_FILENO, &mut termios) == 0 {
                libc::cfmakeraw(&mut termios);
                let _ = libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &termios);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn quotes_bridge_paths_for_the_surface_command() {
            assert_eq!(
                shell_quote("/tmp/Ticketry's bridge"),
                "'/tmp/Ticketry'\"'\"'s bridge'"
            );
        }

        #[test]
        fn frame_validation_rejects_non_finite_and_out_of_viewport_geometry() {
            assert!(validate_frame(8.0, 8.0, 800.0, 600.0, 1024.0, 768.0).is_ok());
            assert!(validate_frame(f64::NAN, 0.0, 1.0, 1.0, 10.0, 10.0).is_err());
            assert!(validate_frame(8.0, 8.0, 20.0, 20.0, 16.0, 16.0).is_err());
            assert!(validate_frame(0.0, 0.0, 0.0, 1.0, 10.0, 10.0).is_err());
        }

        #[test]
        fn attachment_completion_removes_only_its_handle_from_the_registry() {
            let entries = Arc::new(Mutex::new(HashMap::new()));
            let (first_worker, _first_commands) = mpsc::channel();
            let (second_worker, _second_commands) = mpsc::channel();
            entries.lock().expect("registry").insert(
                "native-first".to_owned(),
                NativeEntry {
                    run_id: "run-first".to_owned(),
                    view: 1,
                    worker: first_worker,
                    socket_path: PathBuf::from("/tmp/native-first.sock"),
                },
            );
            entries.lock().expect("registry").insert(
                "native-second".to_owned(),
                NativeEntry {
                    run_id: "run-second".to_owned(),
                    view: 2,
                    worker: second_worker,
                    socket_path: PathBuf::from("/tmp/native-second.sock"),
                },
            );

            let completed = take_native_entry(&entries, "native-first").expect("entry");

            assert_eq!(completed.run_id, "run-first");
            let registry = entries.lock().expect("registry");
            assert!(!registry.contains_key("native-first"));
            assert!(registry.contains_key("native-second"));
        }
    }
}

#[cfg(not(all(target_os = "macos", feature = "native-libghostty")))]
mod imp {
    use super::NativeTerminalFrame;
    use serde::Serialize;
    use std::io;
    use std::path::Path;

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct NativeTerminalStatus {
        handle: String,
        run_id: String,
        columns: u16,
        rows: u16,
    }

    pub struct NativeTerminalState;

    impl Default for NativeTerminalState {
        fn default() -> Self {
            Self::new()
        }
    }

    impl NativeTerminalState {
        pub fn new() -> Self {
            Self
        }

        pub fn detach_all(&self) {}
    }

    #[tauri::command]
    pub fn native_terminal_available() -> bool {
        false
    }

    #[tauri::command]
    pub fn native_terminal_attach(
        _window: tauri::WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _run_id: String,
    ) -> Result<NativeTerminalStatus, String> {
        Err("native libghostty support is unavailable in this build".to_owned())
    }

    #[tauri::command]
    pub fn native_terminal_set_frame(
        _window: tauri::WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _handle: String,
        _frame: NativeTerminalFrame,
    ) -> Result<NativeTerminalStatus, String> {
        Err("native libghostty support is unavailable in this build".to_owned())
    }

    #[tauri::command]
    pub fn native_terminal_focus(
        _window: tauri::WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _handle: String,
    ) -> Result<(), String> {
        Err("native libghostty support is unavailable in this build".to_owned())
    }

    #[tauri::command]
    pub fn native_terminal_detach(
        _window: tauri::WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _handle: String,
    ) -> Result<(), String> {
        Err("native libghostty support is unavailable in this build".to_owned())
    }

    pub fn run_bridge(_path: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "native libghostty support is unavailable",
        ))
    }
}

pub use imp::*;
