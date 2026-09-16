# Tool discovery still builds an environment for an uncalled backend path

Tag: `delete`. Confidence: high for this repository.

Locations:

- `studio/src-tauri/crates/execution/ticketry-tool-discovery/src/lib.rs:55-86`
- `studio/src-tauri/crates/execution/ticketry-tool-discovery/src/supported_tools.rs:38-46`
- `studio/src-tauri/crates/execution/ticketry-tool-discovery/src/tests.rs:177-183`

resolved_tool_environment has no caller. Its private helper probes all supported tools, builds MUXED_APPROVED_* environment entries, and assembles a PATH. Only a test calls the private helper. The comment explains a libtmux subprocess path, but the checked-in application has no consumer of this exporter or those five variables.

Delete the public exporter, private environment builder, and environment_name mapping. Remove only the test's environment-export assertion; retain its meaningful checks that an invalid executable path is rejected and not persisted. Keep preflight discovery and explicit executable approval.

Update `studio/src-tauri/tests/fixtures/public-api.txt` to remove the retired export and run the public API boundary contract test. Do not remove the separately used MUXED_APPROVED_GH_PATH path in workspace runtime.

Validation: whole-repository caller search, tool-discovery tests, and public API boundary checks. Roughly 50 lines can go without replacing the dead environment path.
