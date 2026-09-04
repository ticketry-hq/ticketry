//! The native terminal viewer, from webview command down to tmux client.
//!
//! Three layers, each depending only on the one below it.
//! [`webview_commands`] is the boundary JavaScript reaches; [`attachment`]
//! keeps the transport independent of any renderer; `tmux_client` owns the
//! transient PTY client and stays private so no caller outside this module can
//! reach tmux directly.

mod attachment;
mod tmux_client;
mod webview_commands;
mod worker_diagnostics;

pub use attachment::{
    AttachmentOutcome, TerminalAttachment, TerminalAttachmentControl, TerminalAttachmentError,
    TerminalCommandAttachment, TerminalCommandAttachmentControl, TerminalScrollDirection,
};
pub use webview_commands::{
    viewer_attach, viewer_detach, viewer_input, viewer_resize, viewer_scroll, viewer_status,
    ViewerChannelEvent, ViewerCloseReason, ViewerCommandError, ViewerCommandState,
    ViewerFailureCode, ViewerFailureLayer, ViewerLifecycle, ViewerScrollDirection, ViewerStatus,
};
