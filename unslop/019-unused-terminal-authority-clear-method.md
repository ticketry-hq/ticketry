# Terminal authority clear method has no caller

Tag: `delete`. Confidence: high for this repository.

Location: `studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/lifecycle/work.rs:202-211`.

InteractiveTerminalLaunchRuntime::clear_authority takes a write lock and clears the configured MCP URL. There are no calls anywhere in the repository. It exposes another way to mutate launch authority that the current lifecycle never uses.

Delete this unused method. Keep configure, replace_mcp_authority, and the real launch-time authority validation. This finding does not propose removing MCP failure handling.

Validation: whole-repository symbol search, terminal crate tests, and the public API boundary check. Preserve the active reconfiguration and failed-launch cases.
