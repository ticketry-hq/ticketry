# Document loads can apply an obsolete response

Priority: P1. Effort: Small. Category: Correctness and hygiene.

## Evidence

- [studio/src/app/shell/ticket-workspace/selected-ticket/documents/queries.ts](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/queries.ts), line 119, `const controller = new AbortController();`.
- [studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx), line 128, `void loadDocumentContent(doc)`.

## Why change it

`loadDocumentContent` creates an AbortController that no caller can abort. The viewer effect has no cleanup or request-generation check. Two loads for the same document can finish out of order after a digest update. The older response can replace newer Markdown, HTML, and digest state. It can also replace the draft if editing began while the request was pending.

## Smallest useful refactor

Accept an AbortSignal from the viewer and abort in effect cleanup. Guard response application against a superseded request and a draft that became dirty after loading started. Reuse that loading path for explicit reloads.

## Validation

Use deferred responses in an acceptance case. Start load A, trigger digest B, resolve B before A, and assert B remains visible. Also edit while a request is pending and verify its response cannot overwrite the draft. This is separate from the redundant loads in finding 001.
