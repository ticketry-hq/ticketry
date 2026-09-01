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

//! The three implementation trees are private. The facade preserves the
//! Tauri entry point, the native-terminal command seam, and the small
//! platform-neutral native-terminal test seam as explicit root exports.

// These roots are crate-private rather than externally public because Tauri's
// command macro resolves generated wrappers beside the original functions.
// The public API below is still the only cross-crate facade.
pub(crate) mod app_updates;
pub(crate) mod desktop;
pub(crate) mod native_terminal;

// Tauri/binary seam: the root package supplies the generated context and
// calls this composition-root entry point.
pub use desktop::run;

// These aliases are crate-visible implementation seams needed by the
// private updater tree to cross its desktop sibling boundary.
pub(crate) use desktop::data_directory::DesktopDataDirectoryOwnership;
pub(crate) use desktop::lifecycle::tear_down_before_exit;

// Native-terminal test/integration seam. Keep the implementation modules
// private while retaining one stable, model-free facade for viewer mechanics.
pub use native_terminal::frames::NativeTerminalFrame;
pub use native_terminal::scroll::{
    ScrollGestureSink, MAX_NATIVE_SCROLL_LINES, SCROLL_DIRECTION_DOWN, SCROLL_DIRECTION_NONE,
    SCROLL_DIRECTION_UP,
};
pub use native_terminal::worker::{
    run_native_worker, NativeViewerCommand, NativeViewerControl, NativeWorkerExit,
};
