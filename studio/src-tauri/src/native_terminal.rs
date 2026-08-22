//! Native Terminal facade and platform-neutral viewer mechanics.
//!
//! On macOS, libghostty owns the renderer-facing PTY and launches the validated
//! tmux attach command directly. tmux remains the durable session owner while
//! the native surface is only a transient viewer. Other builds expose the same
//! command surface as an unavailable implementation.

pub mod chords;
pub mod focus_trace;
pub mod frames;
mod preparation;
pub mod scroll;
#[cfg(any(test, all(target_os = "macos", feature = "native-libghostty")))]
mod visibility;
pub mod worker;

pub use frames::NativeTerminalFrame;

#[cfg(all(target_os = "macos", feature = "native-libghostty"))]
#[path = "native_terminal/macos/mod.rs"]
mod imp;

#[cfg(not(all(target_os = "macos", feature = "native-libghostty")))]
mod imp {
    use super::NativeTerminalFrame;
    use serde::Serialize;

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
    pub(crate) fn native_terminal_attach(
        _window: tauri::WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _launch: tauri::State<'_, crate::desktop::launch_runtime::DesktopLaunchRuntime>,
        _run_id: String,
        _viewer_id: String,
        _frame: NativeTerminalFrame,
    ) -> Result<NativeTerminalStatus, String> {
        Err("native libghostty support is unavailable in this build".to_owned())
    }

    #[tauri::command]
    pub fn native_terminal_reconcile_frame(
        _state: tauri::State<'_, NativeTerminalState>,
        _run_id: String,
        _frame: NativeTerminalFrame,
    ) -> Result<(), String> {
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
    pub fn native_terminal_hide(
        _window: tauri::WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _handle: String,
    ) -> Result<(), String> {
        Err("native libghostty support is unavailable in this build".to_owned())
    }

    #[tauri::command]
    pub fn native_terminal_show(
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
}

pub use imp::*;
