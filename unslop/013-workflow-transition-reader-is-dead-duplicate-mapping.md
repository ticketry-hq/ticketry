# Unused workflow-transition reader duplicates an active read path

Tag: `delete`. Confidence: high for checked-in callers.

Location: `studio/src/features/workflows/queries/readTransport.ts:12-26`.

readWorkflowTransitions fetches the catalog, finds an issue type, and maps transition rows. A whole-repository search finds no caller or re-export. The same file's active readWorkflowSettings path already reads transitions and supplies them to assembleScopedWorkflowSettings, with explicit ordering.

Delete the unused 15-line reader. Keep readWorkflowSettings and its mapping. Do not extract another abstraction to preserve the unused variant.

Validation: whole-repository symbol search and frontend typecheck. Existing workflow settings tests cover the retained path.
