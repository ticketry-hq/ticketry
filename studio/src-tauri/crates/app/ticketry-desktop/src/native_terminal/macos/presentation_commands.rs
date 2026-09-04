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
    state
        .ordering
        .lock()
        .expect("native terminal ordering poisoned")
        .clear_selected(&handle);
    let view = {
        let registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        crate::native_terminal::focus_trace::trace(
            "command hide",
            &format!("run={} handle={handle}", entry.run_id),
        );
        entry.view
    };
    // Do not let the Rust ledger turn this into a no-op. A native show can have
    // reached AppKit while its command is still settling its ledger entry; a
    // modal-driven hide that arrives in that interval must still hide the
    // actual NSView. `muxed_ghostty_view_hide` is idempotent, and visibility
    // preserves the first focused hide for the next eligible reveal.
    //
    // Hiding makes AppKit resign first responder, so whether this viewer holds
    // the keyboard has to be read before the view is hidden. The next reveal
    // uses it to give the keyboard back.
    let (hidden_sender, hidden_receiver) = mpsc::channel();
    window
        .run_on_main_thread(move || {
            let focused = unsafe { muxed_ghostty_view_is_focused(view as *mut c_void) };
            unsafe { muxed_ghostty_view_hide(view as *mut c_void) };
            let _ = hidden_sender.send(focused);
        })
        .map_err(|error| error.to_string())?;
    let focused = hidden_receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "timed out hiding the native terminal view".to_owned())?;
    state
        .entries
        .lock()
        .expect("native terminal registry poisoned")
        .get_mut(&handle)
        .ok_or_else(|| "native terminal handle was not found".to_owned())?
        .visibility
        .hide(focused);
    Ok(())
}

#[tauri::command]
pub fn native_terminal_show(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    handle: String,
    frame: NativeTerminalFrame,
) -> Result<NativeTerminalStatus, String> {
    validate_native_frame(frame)?;
    let (view, run_id, contexts) = {
        let registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        (entry.view, entry.run_id.clone(), entry.contexts)
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
                    contexts.scroll as *mut c_void,
                );
                // A hidden viewer has no keyboard, so Studio chords are
                // recognised only while the surface is on screen.
                muxed_ghostty_view_set_chord_callback(
                    view as *mut c_void,
                    Some(report_studio_chord),
                    contexts.chord as *mut c_void,
                );
                muxed_ghostty_view_set_resize_callback(
                    view as *mut c_void,
                    Some(report_grid_resize),
                    contexts.process as *mut c_void,
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
    let restore_focus = {
        let mut registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get_mut(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        entry
            .visibility
            .show_after_frame(size.columns, size.rows)
            .map_err(str::to_owned)?;
        entry.visibility.take_focus_restoration()
    };
    crate::native_terminal::focus_trace::trace(
        "command show",
        &format!("run={run_id} handle={handle} restoresFocus={restore_focus}"),
    );
    // A viewer the user was typing into keeps the keyboard across a hide/show
    // cycle it never asked for; one that was idle must not steal it.
    if restore_focus {
        window
            .run_on_main_thread(move || unsafe {
                muxed_ghostty_view_focus(view as *mut c_void);
            })
            .map_err(|error| error.to_string())?;
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
    let view = {
        let registry = state
            .entries
            .lock()
            .expect("native terminal registry poisoned");
        let entry = registry
            .get(&handle)
            .ok_or_else(|| "native terminal handle was not found".to_owned())?;
        if !entry.visibility.accepts_input() {
            crate::native_terminal::focus_trace::trace(
                "command focus REJECTED (viewer not presented)",
                &format!("run={} handle={handle}", entry.run_id),
            );
            return Err("hidden native terminal cannot receive focus".to_owned());
        }
        crate::native_terminal::focus_trace::trace(
            "command focus",
            &format!("run={} handle={handle}", entry.run_id),
        );
        entry.view
    };
    window
        .run_on_main_thread(move || unsafe {
            muxed_ghostty_view_focus(view as *mut c_void);
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn native_terminal_set_webview_interaction(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    handle: String,
    webview_focus: bool,
    overlay_frames: Vec<NativeTerminalFrame>,
    generation: u64,
) -> Result<(), String> {
    validate_webview_interaction_frames(&overlay_frames)?;
    let entries = Arc::clone(&state.entries);
    let ordering = Arc::clone(&state.ordering);
    let (ordering_sender, ordering_receiver) = mpsc::channel();
    window
        .run_on_main_thread(move || {
            let registry = entries.lock().expect("native terminal registry poisoned");
            let selection_eligible = !webview_focus
                && registry
                    .get(&handle)
                    .is_some_and(|entry| entry.visibility.is_presented());
            let mut handles = registry.keys().cloned().collect::<Vec<_>>();
            handles.sort();
            let requested = (!webview_focus).then_some(handle.as_str());
            let operations = ordering
                .lock()
                .expect("native terminal ordering poisoned")
                .transition(generation, requested, selection_eligible, &handles);

            let mut ordered = true;
            for operation in operations {
                let (operation_handle, webview_owns_input) = match operation {
                    NativeOrderingOperation::Lower(handle) => (handle, true),
                    NativeOrderingOperation::Raise(handle) => (handle, false),
                };
                // A failed lower means another view may still own native
                // input. Never raise the requested view in that state.
                if !webview_owns_input && !ordered {
                    continue;
                }
                let Some(entry) = registry.get(&operation_handle) else {
                    ordered = false;
                    continue;
                };
                if !unsafe {
                    muxed_ghostty_view_set_webview_interaction(
                        entry.view as *mut c_void,
                        webview_owns_input,
                    )
                } {
                    ordered = false;
                }
            }
            if !ordered {
                ordering
                    .lock()
                    .expect("native terminal ordering poisoned")
                    .clear_selected(&handle);
            }
            let _ = ordering_sender.send(ordered);
        })
        .map_err(|error| error.to_string())?;
    let ordered = ordering_receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "timed out changing native terminal sibling order".to_owned())?;
    sibling_ordering_result(ordered)
}

fn sibling_ordering_result(ordered: bool) -> Result<(), String> {
    ordered
        .then_some(())
        .ok_or_else(|| "failed to change native terminal sibling order".to_owned())
}

#[tauri::command]
pub fn native_terminal_detach(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    handle: String,
) -> Result<(), String> {
    detach_native_handle(&window, &state.entries, &state.ordering, &handle)
}
