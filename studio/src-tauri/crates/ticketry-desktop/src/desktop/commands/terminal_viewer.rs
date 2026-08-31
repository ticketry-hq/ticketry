//! Tauri command boundary for xterm terminal viewers.
//!
//! Commands are shell composition: each one resolves the services it needs
//! from the desktop launch runtime and delegates straight into the terminal
//! slice's viewer operations. No viewer mechanics live here.

use tauri::ipc::Channel;

use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use ticketry_terminal::terminal::viewer::webview_commands::{
    self, ViewerChannelEvent, ViewerCommandError, ViewerCommandState, ViewerScrollDirection,
    ViewerStatus,
};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn viewer_attach(
    state: tauri::State<'_, ViewerCommandState>,
    launch: tauri::State<'_, DesktopLaunchRuntime>,
    run_id: String,
    viewer_id: String,
    columns: u16,
    rows: u16,
    output: Channel<ViewerChannelEvent>,
) -> Result<ViewerStatus, ViewerCommandError> {
    let ownership = launch
        .viewer_ownership()
        .map_err(|message| ViewerCommandError::Pty { message })?;
    webview_commands::viewer_attach(
        &state,
        launch.output_activity().ok(),
        ownership,
        run_id,
        viewer_id,
        columns,
        rows,
        output,
    )
}

#[tauri::command]
pub fn viewer_input(
    state: tauri::State<'_, ViewerCommandState>,
    viewer_handle: String,
    data: Vec<u8>,
) -> Result<(), ViewerCommandError> {
    webview_commands::viewer_input(&state, viewer_handle, data)
}

#[tauri::command]
pub fn viewer_resize(
    state: tauri::State<'_, ViewerCommandState>,
    viewer_handle: String,
    columns: u16,
    rows: u16,
) -> Result<(), ViewerCommandError> {
    webview_commands::viewer_resize(&state, viewer_handle, columns, rows)
}

#[tauri::command]
pub fn viewer_scroll(
    state: tauri::State<'_, ViewerCommandState>,
    viewer_handle: String,
    direction: ViewerScrollDirection,
    lines: u16,
) -> Result<(), ViewerCommandError> {
    webview_commands::viewer_scroll(&state, viewer_handle, direction, lines)
}

#[tauri::command]
pub fn viewer_detach(
    state: tauri::State<'_, ViewerCommandState>,
    viewer_handle: String,
) -> Result<ViewerStatus, ViewerCommandError> {
    webview_commands::viewer_detach(&state, viewer_handle)
}

#[tauri::command]
pub fn viewer_status(
    state: tauri::State<'_, ViewerCommandState>,
    viewer_handle: String,
) -> Result<ViewerStatus, ViewerCommandError> {
    webview_commands::viewer_status(&state, viewer_handle)
}
