// libghostty/AppKit bridge declarations and callback adapters.

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct GhosttyGridSize {
    columns: u16,
    rows: u16,
}

unsafe extern "C" {
    fn muxed_ghostty_host_is_main_thread() -> bool;
    fn muxed_ghostty_runtime_new() -> *mut c_void;
    fn muxed_ghostty_runtime_free(runtime: *mut c_void);
    fn muxed_ghostty_view_new(
        runtime: *mut c_void,
        parent_view: *mut c_void,
        command: *const c_char,
        process_exit_callback: Option<unsafe extern "C" fn(*mut c_void, u32)>,
        process_exit_context: *mut c_void,
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
    fn muxed_ghostty_view_arm_redraw(view: *mut c_void) -> u64;
    fn muxed_ghostty_view_wait_for_redraw(
        view: *mut c_void,
        generation: u64,
        timeout_milliseconds: u32,
    ) -> bool;
    fn muxed_ghostty_view_hide(view: *mut c_void);
    fn muxed_ghostty_view_show(
        view: *mut c_void,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        viewport_width: f64,
        viewport_height: f64,
    ) -> GhosttyGridSize;
    fn muxed_ghostty_view_is_focused(view: *mut c_void) -> bool;
    fn muxed_ghostty_view_focus(view: *mut c_void);
    fn muxed_ghostty_view_set_scroll_callback(
        view: *mut c_void,
        callback: Option<unsafe extern "C" fn(*mut c_void, u8, u16)>,
        context: *mut c_void,
    );
    fn muxed_ghostty_view_set_resize_callback(
        view: *mut c_void,
        callback: Option<unsafe extern "C" fn(*mut c_void, u16, u16)>,
        context: *mut c_void,
    );
    fn muxed_ghostty_view_set_chord_callback(
        view: *mut c_void,
        callback: Option<unsafe extern "C" fn(*mut c_void, u8)>,
        context: *mut c_void,
    );
    fn muxed_ghostty_view_disable_chord_callback(view: *mut c_void);
    // The native view recognises the chords itself; Ticketry calls this only
    // to assert that its policy still matches the Studio keymap.
    #[cfg(test)]
    fn muxed_ghostty_studio_chord(modifier_flags: u64, key_code: u16) -> u8;
    fn muxed_ghostty_view_disable_scroll_callback(view: *mut c_void);
    fn muxed_ghostty_view_disable_resize_callback(view: *mut c_void);
    fn muxed_ghostty_view_disable_process_exit_callback(view: *mut c_void);
    // The native view normalizes its own gestures; Ticketry calls this only
    // to assert the policy the view applies.
    #[cfg(test)]
    fn muxed_ghostty_normalize_scroll(
        vertical_delta: f64,
        precise: bool,
    ) -> GhosttyScrollIntent;
}

#[cfg(test)]
#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct GhosttyScrollIntent {
    direction: u8,
    lines: u16,
}

/// Reported by the native view on AppKit's main thread for every accepted
/// vertical gesture. The context stays alive until Viewer detachment has
/// disabled callbacks for that view.
unsafe extern "C" fn report_scroll_gesture(context: *mut c_void, direction: u8, lines: u16) {
    if context.is_null() {
        return;
    }
    let sink = unsafe { &*(context as *const ScrollGestureSink) };
    sink.accept(direction, lines);
}

/// Reported by the native view on AppKit's main thread when it recognises a
/// Studio chord instead of forwarding it to the terminal.
unsafe extern "C" fn report_studio_chord(context: *mut c_void, chord: u8) {
    if context.is_null() {
        return;
    }
    let Some(chord) = StudioChord::from_native(chord) else {
        return;
    };
    let sink = unsafe { &*(context as *const ChordSink) };
    sink.report(chord);
}

unsafe extern "C" fn report_process_exit(context: *mut c_void, _exit_code: u32) {
    if context.is_null() {
        return;
    }
    let worker = unsafe { &*(context as *const mpsc::Sender<NativeViewerCommand>) };
    let _ = worker.send(NativeViewerCommand::AttachmentExited);
}

unsafe extern "C" fn report_grid_resize(context: *mut c_void, columns: u16, rows: u16) {
    if context.is_null() || columns == 0 || rows == 0 {
        return;
    }
    let worker = unsafe { &*(context as *const mpsc::Sender<NativeViewerCommand>) };
    let _ = worker.send(NativeViewerCommand::Resize(columns, rows));
}
