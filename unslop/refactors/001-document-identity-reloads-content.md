# Document rows lose identity and trigger redundant content loads

Priority: P1. Effort: Small. Category: Performance and correctness.

## Evidence

- [studio/src/app/shell/ticket-workspace/selected-ticket/documents/queries.ts](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/queries.ts), line 107, `documents: rows?.map`.
- [studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx), line 159, `}, [doc, editable]);`.
- [studio/src/app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTabBody.tsx](../../studio/src/app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTabBody.tsx), line 178, `{openDocuments.map`.

## Why change it

`useWorkspaceDocuments` creates a fresh array and fresh document objects on every render. Those objects reach each mounted document viewer. Its loading effect depends on the entire `doc` object, so an unrelated workspace render can fetch and render unchanged Markdown again. Hidden document tabs remain mounted too. For a dirty editor, the same effect instead sets `externalChange`, so identity churn can also report an external change without a digest change. The comment claiming unchanged bytes preserve the row identity is contradicted by the mapping.

## Smallest useful refactor

Memoize adaptation against the query rows. Make content loading depend on document identity, path, content digest, and editability explicitly. A change to a display label should not fetch document bytes.

## Validation

Add an acceptance case that opens two Markdown tabs, edits one, then changes workspace focus. Assert no additional content requests and no external-change notice. Updating the content digest must still reload a clean viewer and preserve a dirty draft.
