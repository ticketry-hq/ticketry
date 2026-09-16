# Desktop notice publishing method has no caller

Tag: `delete`. Confidence: high for this repository.

Location: `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/service_state.rs:74-78`.

publish_notice clones a notice, retains it, and emits a desktop-user-notice event when newly inserted. No checked-in caller uses this method. The retained-notice path and runtime configuration still have active uses.

Delete the unused method. Keep retain_notice, notice serialization, initialNotices delivery, and any independently used event contract. Remove an import only if the remaining service-health publisher does not need it.

Validation: compile the desktop crate and run notice/startup tests. Confirm MCP failure notices still arrive through the existing configuration path.
