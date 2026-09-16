import { Suspense } from "react";

import type { DesignDoc } from "./types";

import { LazyRichMarkdownEditor as RichMarkdownEditor } from "./richMarkdownEditorLoader";

export function MarkdownDocumentEditor({
  doc,
  digest,
  draft,
  markdown,
  conflictDigest,
  externalChange,
  externalMarkdown,
  loadingExternal,
  parseFallback,
  saveError,
  saving,
  sourceMode,
  onCancel,
  onCompare,
  onDraftChange,
  onOverwrite,
  onParseError,
  onReload,
  onSave,
}: {
  doc: DesignDoc;
  digest: string;
  draft: string;
  markdown: string;
  conflictDigest: string | null;
  externalChange: boolean;
  externalMarkdown: string | null;
  loadingExternal: boolean;
  parseFallback: boolean;
  saveError: boolean;
  saving: boolean;
  sourceMode: boolean;
  onCancel: () => void;
  onCompare: () => void;
  onDraftChange: (value: string) => void;
  onOverwrite: (digest: string) => void;
  onParseError: (source: string) => void;
  onReload: () => void;
  onSave: () => void;
}) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-pane-bg">
      <div
        className="sticky top-0 z-10 flex min-h-12 flex-none items-center gap-3 border-b border-pane-border bg-pane-title/95 px-3 py-2 shadow-sm"
        data-testid="document-editor-action-row"
      >
        <button
          type="button"
          disabled={saving || loadingExternal || draft === markdown}
          className="border border-blue-600 bg-blue-600 px-2.5 py-1 text-xs text-white shadow-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={saving ? "Saving document" : "Save document"}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <div className="min-w-0 flex-1">
          {conflictDigest ? (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <span className="text-xs font-medium text-lifecycle-attention">
                This document changed on disk before your save.
              </span>
              <button
                type="button"
                disabled={saving || loadingExternal}
                className="border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent disabled:opacity-50"
                aria-label="Reload theirs"
                onClick={onReload}
              >
                Reload theirs
              </button>
              <button
                type="button"
                disabled={saving || loadingExternal}
                className="border border-lifecycle-attention bg-lifecycle-attention/15 px-2.5 py-1 text-xs text-lifecycle-attention hover:bg-lifecycle-attention/25 disabled:opacity-50"
                aria-label="Overwrite with mine"
                onClick={() => onOverwrite(conflictDigest)}
              >
                Overwrite with mine
              </button>
            </div>
          ) : externalChange ? (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <span className="text-xs font-medium text-lifecycle-attention">
                This document changed on disk. Your edits are still here.
              </span>
              <button
                type="button"
                disabled={saving || loadingExternal}
                className="border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent disabled:opacity-50"
                aria-label="Reload external version"
                onClick={onReload}
              >
                Reload
              </button>
              <button
                type="button"
                disabled={saving || loadingExternal}
                className="border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent disabled:opacity-50"
                aria-label="Compare versions"
                onClick={onCompare}
              >
                Compare
              </button>
            </div>
          ) : saveError ? (
            <span className="text-xs font-medium text-lifecycle-danger" role="alert">
              Save failed
            </span>
          ) : draft !== markdown ? (
            <span className="text-xs font-medium text-lifecycle-attention" role="status">
              Unsaved changes
            </span>
          ) : null}
        </div>
        {saveError && (conflictDigest || externalChange) ? (
          <span className="text-xs font-medium text-lifecycle-danger" role="alert">
            Save failed
          </span>
        ) : null}
        <button
          type="button"
          disabled={saving || loadingExternal}
          className="border border-pane-border bg-pane-panel/95 px-2.5 py-1 text-xs text-text-primary shadow-md hover:border-focus-accent"
          aria-label="Cancel editing"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        data-testid="document-editor-scroll-region"
      >
        {externalMarkdown !== null ? (
          <div
            className="grid gap-3 border-b border-pane-border bg-pane-title p-4 md:grid-cols-2"
            role="region"
            aria-label="Document comparison"
          >
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Mine
              </h3>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap border border-pane-border bg-pane-panel p-3 text-xs text-text-primary">
                {draft}
              </pre>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                On disk
              </h3>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap border border-pane-border bg-pane-panel p-3 text-xs text-text-primary">
                {externalMarkdown}
              </pre>
            </section>
          </div>
        ) : null}
        <div className="w-full">
          {sourceMode ? (
            <div className="px-8 py-10">
              {parseFallback ? (
                <p className="mb-3 text-sm text-lifecycle-attention" role="status">
                  Rich editing is unavailable for this document. Editing the
                  original Markdown source instead.
                </p>
              ) : null}
              <textarea
                aria-label="Document source"
                className="min-h-[60vh] w-full resize-y border border-pane-border bg-pane-panel p-4 font-mono text-sm text-text-primary focus:border-focus-accent focus:outline-none"
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
              />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="p-8 text-sm text-text-muted" role="status">
                  Loading editor…
                </div>
              }
            >
              <RichMarkdownEditor
                key={`${doc.id}:${doc.rel_path}:${digest}`}
                markdown={draft}
                onChange={onDraftChange}
                onParseError={onParseError}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
