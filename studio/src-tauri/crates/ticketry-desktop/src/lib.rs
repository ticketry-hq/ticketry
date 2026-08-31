//! The desktop shell: the composition root that turns the slices into an app.
//!
//! [`desktop`] is the Tauri application itself — every `#[tauri::command]`
//! handler, the taurpc router, plugin and protocol setup, the service state
//! the window reads, startup and lifecycle, the data-directory and workspace
//! handoffs, crash reporting and readiness publication. [`native_terminal`]
//! is the macOS libghostty viewer the shell hosts beside the webview: its
//! worker, frame and scroll bridges, chord capture and visibility tracking.
//! [`app_updates`] is the updater the shell offers the user — the release
//! contract, the download-and-install operation, and its acceptance surface.
//!
//! Nothing else in the workspace depends on this crate; the `ticketry`
//! binary's `main.rs` is its only caller.

pub mod app_updates;
pub mod desktop;
pub mod native_terminal;
