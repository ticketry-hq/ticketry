// Shared AppKit helpers plus worker completion and cleanup lifecycle.

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

/// Preparation blocks on the first libghostty redraw, which needs the main
/// runloop free to make progress. This
/// refuses to start (or to keep going) on the main thread instead of hanging
/// the UI until the preparation timeout expires.
fn ensure_preparation_thread() -> Result<(), String> {
    if unsafe { muxed_ghostty_host_is_main_thread() } {
        return Err("native terminal preparation cannot run on the main thread".to_owned());
    }
    Ok(())
}

fn spawn_worker(setup: WorkerSetup) {
    let WorkerSetup {
        control,
        commands,
        window,
        entries,
        handle,
        run_id,
        preparation_phase,
    } = setup;
    thread::spawn(move || match run_native_worker(control, &commands) {
        NativeWorkerExit::AttachmentExited => {
            let phase = preparation_phase.swap(FAILED, Ordering::AcqRel);
            if phase == PRESENTED {
                close_worker_entry(&entries, &window, &handle);
            }
            let _ = window.emit(
                "native-terminal-closed",
                NativeTerminalCompletion {
                    handle: handle.clone(),
                    run_id: run_id.clone(),
                    reason: "attachment_process_exited".to_owned(),
                },
            );
        }
        NativeWorkerExit::ResizeFailed(reason) => {
            let phase = preparation_phase.swap(FAILED, Ordering::AcqRel);
            if phase == PRESENTED {
                close_worker_entry(&entries, &window, &handle);
            }
            let _ = window.emit(
                "native-terminal-failed",
                NativeTerminalFailure {
                    handle: handle.clone(),
                    run_id: run_id.clone(),
                    reason,
                },
            );
        }
        NativeWorkerExit::Detached | NativeWorkerExit::CommandsDisconnected => {}
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

/// Removes the native view on AppKit's main thread. Callbacks are disabled
/// first and their contexts released last, so each context outlives every
/// event the view could still emit.
fn free_view(
    window: &tauri::WebviewWindow,
    view: usize,
    scroll_context: usize,
    process_context: usize,
) -> tauri::Result<()> {
    window.run_on_main_thread(move || {
        unsafe {
            muxed_ghostty_view_disable_scroll_callback(view as *mut c_void);
            muxed_ghostty_view_disable_resize_callback(view as *mut c_void);
            muxed_ghostty_view_disable_process_exit_callback(view as *mut c_void);
            muxed_ghostty_view_free(view as *mut c_void);
        };
        release_scroll_context(scroll_context);
        release_process_context(process_context);
    })
}

/// Drops the leaked `Arc<ScrollGestureSink>` handed to a native view.
fn release_scroll_context(scroll_context: usize) {
    if scroll_context == 0 {
        return;
    }
    drop(unsafe { Arc::from_raw(scroll_context as *const ScrollGestureSink) });
}

fn release_process_context(process_context: usize) {
    if process_context == 0 {
        return;
    }
    drop(unsafe { Arc::from_raw(process_context as *const mpsc::Sender<NativeViewerCommand>) });
}

fn cleanup_entry(
    entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
    window: &tauri::WebviewWindow,
    handle: &str,
) {
    let Some(entry) = take_native_entry(entries, handle) else {
        return;
    };
    entry.scroll_sink.stop_accepting();
    let _ = entry.worker.send(NativeViewerCommand::Detach);
    let _ = free_view(
        window,
        entry.view,
        entry.scroll_context,
        entry.process_context,
    );
}

fn close_worker_entry(
    entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
    window: &tauri::WebviewWindow,
    handle: &str,
) {
    let Some(entry) = take_native_entry(entries, handle) else {
        return;
    };
    entry.scroll_sink.stop_accepting();
    let _ = free_view(
        window,
        entry.view,
        entry.scroll_context,
        entry.process_context,
    );
}

fn new_handle() -> String {
    format!("native-{:032x}", rand::thread_rng().gen::<u128>())
}

/// CSS viewport coordinates are relative to WKWebView, not the window's
/// full content view. The latter includes the macOS titlebar inset and
/// shifts native overlays upward when full-size content is enabled.
fn webview_ns_view(window: &tauri::WebviewWindow) -> Result<usize, String> {
    let (sender, receiver) = mpsc::channel();
    window
        .with_webview(move |webview| {
            let _ = sender.send(webview.inner() as usize);
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "timed out resolving the native webview coordinate space".to_owned())
}

/// Applies a frame to a viewer that has not been presented yet and reports
/// the grid libghostty measured for it.
fn apply_frame(
    window: &tauri::WebviewWindow,
    view: usize,
    frame: NativeTerminalFrame,
) -> Result<TerminalGrid, String> {
    let NativeTerminalFrame {
        x,
        y,
        width,
        height,
        viewport_width,
        viewport_height,
    } = frame;
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
        .map_err(|_| "timed out applying the native terminal frame".to_owned())?;
    TerminalGrid::new(size.columns, size.rows).map_err(str::to_owned)
}

