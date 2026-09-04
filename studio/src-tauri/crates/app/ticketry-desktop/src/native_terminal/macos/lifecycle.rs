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
        ordering,
        handle,
        run_id,
        preparation_phase,
    } = setup;
    thread::spawn(move || match run_native_worker(control, &commands) {
        NativeWorkerExit::AttachmentExited => {
            let phase = preparation_phase.swap(FAILED, Ordering::AcqRel);
            if phase == PRESENTED {
                close_worker_entry(&entries, &ordering, &window, &handle);
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
                close_worker_entry(&entries, &ordering, &window, &handle);
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

/// Builds the sink that forwards each recognised Studio chord to the WebView.
/// The native view only reports the chord; the WebView keymap binding stays
/// the single owner of what that chord means.
fn chord_sink(window: &tauri::WebviewWindow, handle: &str, run_id: &str) -> Arc<ChordSink> {
    let window = window.clone();
    let handle = handle.to_owned();
    let run_id = run_id.to_owned();
    ChordSink::new(move |chord: StudioChord| {
        let _ = window.emit(
            NATIVE_CHORD_EVENT,
            NativeTerminalChord {
                handle: handle.clone(),
                run_id: run_id.clone(),
                chord: chord.as_str(),
            },
        );
    })
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
    contexts: NativeViewContexts,
) -> tauri::Result<()> {
    window.run_on_main_thread(move || unsafe { free_view_and_contexts(view, contexts) })
}

/// Drops every leaked callback context handed to one native view.
fn release_view_contexts(contexts: NativeViewContexts) {
    release_scroll_context(contexts.scroll);
    release_chord_context(contexts.chord);
    release_process_context(contexts.process);
}

/// Drops the leaked `Arc<ScrollGestureSink>` handed to a native view.
fn release_scroll_context(scroll_context: usize) {
    if scroll_context == 0 {
        return;
    }
    drop(unsafe { Arc::from_raw(scroll_context as *const ScrollGestureSink) });
}

/// Drops the leaked `Arc<ChordSink>` handed to a native view.
fn release_chord_context(chord_context: usize) {
    if chord_context == 0 {
        return;
    }
    drop(unsafe { Arc::from_raw(chord_context as *const ChordSink) });
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
    entry.stop_accepting_events();
    let _ = entry.worker.send(NativeViewerCommand::Detach);
    let _ = free_view(window, entry.view, entry.contexts);
}

fn close_worker_entry(
    entries: &Arc<Mutex<HashMap<String, NativeEntry>>>,
    ordering: &Arc<Mutex<NativeWindowOrdering>>,
    window: &tauri::WebviewWindow,
    handle: &str,
) {
    let Some(entry) = take_native_entry(entries, handle) else {
        return;
    };
    ordering
        .lock()
        .expect("native terminal ordering poisoned")
        .clear_selected(handle);
    entry.stop_accepting_events();
    let _ = free_view(window, entry.view, entry.contexts);
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
