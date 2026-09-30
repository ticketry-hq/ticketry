# Settings seed wrappers have no callers

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/settings/queries.ts:197-206`.

seedIssueTypes forwards its two arguments to setIssueTypes. seedCapabilities forwards its two arguments to setCapabilities. Neither adds behavior, and neither has any caller or re-export anywhere in the repository, including tests.

Delete both wrappers. Keep the setters, which belong to the active settings data path. Do not add tests solely to justify the unused seed names.

Validation: whole-repository symbol search and frontend typecheck.
