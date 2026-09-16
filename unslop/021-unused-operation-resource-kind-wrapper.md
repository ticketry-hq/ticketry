# Operation resource-kind wrapper has no caller

Tag: `delete`. Confidence: high for this repository.

Location: `studio/src-tauri/crates/execution/ticketry-workspace-runtime/src/workspace/operations/records.rs:6,54-56`.

typed_resource_kind wraps typed_kind followed by WorkspaceOperationKind::resource_kind. There are no references outside its definition. WorkspaceResourceKind is imported into this file solely for this unused return type.

Delete the method and remove WorkspaceResourceKind from the import. Keep typed_kind and resource, which support actual record processing.

Validation: compile workspace runtime and run the public API boundary check. No new abstraction or test is needed.
