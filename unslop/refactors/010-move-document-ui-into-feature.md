# Document editing lives inside the application shell

Priority: P2. Effort: Medium. Category: Guideline violation and maintainability.

## Evidence

- [studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx), line 24, `export default function DocViewer`.
- [studio/src/app/shell/ticket-workspace/selected-ticket/documents/queries.ts](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/queries.ts), line 25, `export function useWorkspaceDocuments`.
- [studio/src/app/shell/ticket-workspace/selected-ticket/documents/WorkspaceDocument.tsx](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/WorkspaceDocument.tsx), line 11, `export function WorkspaceDocument`.

## Why change it

The document feature owns its transport and types, but document fetching, Markdown rendering, rich editing, save/conflict behavior, and registry-to-view adaptation live under `app/shell/ticket-workspace/selected-ticket/documents`. These are document-domain responsibilities, not shell composition. DocViewer alone is 471 lines. Finding document behavior requires knowing which selected-ticket screen happens to host it.

## Smallest useful refactor

Move document loading, rendering, and editing into `features/documents`. Leave a thin workspace adapter in the shell for tab focus and selection. Split Markdown editing and HTML viewing by concern while moving them, and export the supported viewer through the document feature entry point.

## Validation

Preserve HTML iframe sandboxing, Markdown sanitization, lazy editor loading, save conflicts, draft retention, and tab focus. Run document acceptance cases and the overhaul gate if behavior changes. Findings 001 and 002 describe separate bugs that should have explicit regression coverage.
