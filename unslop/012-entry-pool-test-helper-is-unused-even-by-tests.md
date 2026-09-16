# Entry-pool test helper is unused even by tests

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/agents/terminal/internal/entryPool.ts:440-443`.

_entryCount is labelled test-only and returns entries.size. There are no references to it outside its definition, including tests and scripts.

Delete the function and its comment. Keep the real pool lifecycle tests and diagnostics. There is no reason to expose an internal collection count for a test that does not exist.

Validation: whole-repository symbol search and frontend typecheck. No new test is needed.
