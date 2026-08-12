// Frame, visibility, focus, and explicit detach commands for retained viewers.

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
    let (view, run_id) = {
        let registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        (entry.view, entry.run_id.clone())
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
    Ok(NativeTerminalStatus {
        handle,
        run_id,
        columns: size.columns,
        rows: size.rows,
    })
}

#[tauri::command]
pub fn native_terminal_hide(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    handle: String,
) -> Result<(), String> {
    let view = {
        let mut registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get_mut(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        if !entry.visibility.hide() {
            return Ok(());
        }
        entry.view
    };
    let (hidden_sender, hidden_receiver) = mpsc::channel();
    window
        .run_on_main_thread(move || {
            unsafe { muxed_ghostty_view_hide(view as *mut c_void) };
            let _ = hidden_sender.send(());
        })
        .map_err(|error| error.to_string())?;
    hidden_receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "timed out hiding the native terminal view".to_owned())
}

#[tauri::command]
pub fn native_terminal_show(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    handle: String,
    frame: NativeTerminalFrame,
) -> Result<NativeTerminalStatus, String> {
    validate_native_frame(frame)?;
    let (view, run_id, scroll_context, resize_context) = {
        let registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        (
            entry.view,
            entry.run_id.clone(),
            entry.scroll_context,
            entry.process_context,
        )
    };
    let NativeTerminalFrame {
        x,
        y,
        width,
        height,
        viewport_width,
        viewport_height,
    } = frame;
    let (shown_sender, shown_receiver) = mpsc::channel();
    window
        .run_on_main_thread(move || {
            let size = unsafe {
                muxed_ghostty_view_set_scroll_callback(
                    view as *mut c_void,
                    Some(report_scroll_gesture),
                    scroll_context as *mut c_void,
                );
                muxed_ghostty_view_set_resize_callback(
                    view as *mut c_void,
                    Some(report_grid_resize),
                    resize_context as *mut c_void,
                );
                muxed_ghostty_view_show(
                    view as *mut c_void,
                    x,
                    y,
                    width,
                    height,
                    viewport_width,
                    viewport_height,
                )
            };
            let _ = shown_sender.send(size);
        })
        .map_err(|error| error.to_string())?;
    let size = shown_receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "timed out showing the native terminal view".to_owned())?;
    state
        .entries
        .lock()
        .expect("native terminal registry poisoned")
        .get_mut(&handle)
        .ok_or_else(|| "native terminal handle was not found".to_owned())?
        .visibility
        .show_after_frame(size.columns, size.rows)
        .map_err(str::to_owned)?;
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
    let view = {
        let registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        if !entry.visibility.accepts_input() {
            return Err("hidden native terminal cannot receive focus".to_owned());
        }
        entry.view
    };
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
    // Viewer detachment stops accepting gestures before the native view is
    // removed, so a gesture in flight cannot reach the next viewer.
    entry.scroll_sink.stop_accepting();
    let _ = entry.worker.send(NativeViewerCommand::Detach);
    let released = free_view(
        &window,
        entry.view,
        entry.scroll_context,
        entry.process_context,
    );
    released.map_err(|error| error.to_string())
}

