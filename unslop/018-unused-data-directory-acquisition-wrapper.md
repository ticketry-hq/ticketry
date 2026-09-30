# Data-directory acquisition convenience method has no caller

Tag: `delete`. Confidence: high for this repository.

Location: `studio/src-tauri/crates/foundation/ticketry-data-directory/src/guard.rs:10,27-29`.

DataDirectoryGuard::acquire_established calls acquire with established_data_directory. Whole-repository search finds only the method definition. Application callers already pass their selected directory to acquire.

Delete the wrapper and its now-unused established_data_directory import. Keep acquire, including its ownership checks and cleanup. Explicit directory selection remains available for development-data isolation.

Validation: compile the data-directory crate, run its ownership tests, and run the public API boundary check. Adjust an API fixture only if this associated method is represented there.
