# Status-event count query is unused despite its test-coverage comment

Tag: `delete`. Confidence: high for this repository.

Location: `studio/src-tauri/crates/worktracking/ticketry-runs/src/persistence/repositories.rs:239-246`.

count_for_project is documented as serving compaction evidence and bounded-memory tests. A whole-repository search finds only its definition. No test or runtime code uses the query.

Delete the method and its comment. Keep the active compaction operations and tests. Remove a count-specific trait import only if no remaining query in the file needs it.

Validation: compile ticketry-runs, run its compaction tests, and check the public API boundary. No replacement query or new test is needed for this unused method.
