# Terminal webview commands also implement the viewer worker

Priority: P2. Effort: Medium. Category: Guideline violation and maintainability.

## Evidence

- [studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/viewer/webview_commands.rs](../../studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/viewer/webview_commands.rs), line 32, `pub enum ViewerChannelEvent`.
- [studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/viewer/webview_commands.rs](../../studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/viewer/webview_commands.rs), line 345, `pub fn viewer_attach`.
- [studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/viewer/webview_commands.rs](../../studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/viewer/webview_commands.rs), line 586, `fn spawn_viewer_worker`.

## Why change it

This 951-line file contains public protocol types, runtime state, input validation, command entry points, worker startup and dispatch, output pumping, and detach/close handling. The worker begins at line 586 and the output pump at line 811. A command-contract edit and a worker-lifecycle edit touch the same file despite being separate concerns.

## Smallest useful refactor

Extract private protocol, worker, and validation modules within the terminal viewer capability. Keep command entry points as a small adapter over that implementation. Preserve existing crate-root exports and keep new implementation paths private.

## Validation

Run terminal viewer lifecycle, attach/detach, resize, input, and crash reconciliation tests. Run the public API boundary contract; update its fixture only if an export deliberately changes. Do not change session identity, renderer selection, or tmux ownership as part of this split.
