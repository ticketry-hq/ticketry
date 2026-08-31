//! The native terminal viewer, from webview command down to tmux client.
//!
//! Three layers, each depending only on the one below it.
//! [`webview_commands`] is the boundary JavaScript reaches; [`attachment`]
//! keeps the transport independent of any renderer; `tmux_client` owns the
//! transient PTY client and stays private so no caller outside this module can
//! reach tmux directly.

pub mod attachment;
mod tmux_client;
pub mod webview_commands;
