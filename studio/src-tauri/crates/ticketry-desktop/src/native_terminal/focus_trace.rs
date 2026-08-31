//! Opt-in tracing for native terminal keyboard focus.
//!
//! A spontaneous focus loss is only diagnosable when AppKit's first-responder
//! transitions (traced in `libghostty_focus_trace.m`) can be read next to the
//! app intent that preceded them. Both sides write to stderr, so the desktop
//! dev terminal shows one ordered log. Enable with
//! `MUXED_TERMINAL_FOCUS_TRACE=1`; the trace is inert otherwise.

use std::sync::OnceLock;

fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        std::env::var("MUXED_TERMINAL_FOCUS_TRACE")
            .map(|value| !value.is_empty() && value != "0")
            .unwrap_or(false)
    })
}

/// Records one focus-relevant event; `detail` carries the run/handle context.
pub fn trace(event: &str, detail: &str) {
    if !enabled() {
        return;
    }
    eprintln!("[focus-trace] {event} {detail}");
}

/// Lets the webview record the state change that motivated a native command,
/// so an unexplained hide can be attributed to app intent or to AppKit.
#[tauri::command]
pub fn native_terminal_trace(event: String, detail: String) {
    trace(&event, &detail);
}
