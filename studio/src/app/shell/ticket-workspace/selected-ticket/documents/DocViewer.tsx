import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { dialog } from "../../../../../state/clientStore";
import {
  documentUrl,
  newSaveOperationId,
  saveDocument,
  type DesignDoc,
} from "../../../../../features/documents";
import { renderMarkdown } from "./markdown";
import {
  loadDocumentContent,
  type LoadedMarkdown,
} from "./queries";

/**
 * Render of a registered design document. Markdown is fetched from the
 * registered-document endpoint, sanitized for reading, and can optionally
 * enter rich document edit mode. HTML stays in its sandboxed iframe
 * (`allow-scripts` only, in an opaque origin).
 *
 * Viewer chrome is the host's business, rendered over this frame — never
 * inside it.
 */
export default function DocViewer({
  doc,
  focusSignal = 0,
  editable = false,
}: {
  doc: DesignDoc;
  focusSignal?: number;
  editable?: boolean;
}) {
  if (/\.md$/i.test(doc.rel_path)) {
    return (
      <MarkdownDocViewer
        key={`${doc.id}:${doc.rel_path}`}
        doc={doc}
        focusSignal={focusSignal}
        editable={editable}
      />
    );
  }
  return <HtmlDocViewer doc={doc} focusSignal={focusSignal} />;
}

const RichMarkdownEditor = lazy(() => import("./RichMarkdownEditor"));

export function isFullHtmlDocument(source: string): boolean {
  const trimmed = source.replace(/^\uFEFF/, "").trim();
  const withoutPreamble = trimmed
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "")
    .replace(/^<!doctype\s+html(?:\s[^>]*)?>\s*/i, "");

  return /^<html(?:\s[^>]*)?>[\s\S]*<\/html>\s*$/i.test(withoutPreamble);
}

function HtmlDocViewer({
  doc,
  focusSignal,
}: {
  doc: DesignDoc;
  focusSignal: number;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (focusSignal > 0) frameRef.current?.focus();
  }, [focusSignal]);

  return (
    <iframe
      ref={frameRef}
      title={doc.label}
      src={documentUrl(doc.id, doc.rel_path)}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
      data-testid="workspace-doc-frame"
    />
  );
}

function MarkdownDocViewer({
  doc,
  focusSignal,
  editable,
}: {
  doc: DesignDoc;
  focusSignal: number;
  editable: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [digest, setDigest] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [parseFallback, setParseFallback] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [conflictDigest, setConflictDigest] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [externalMarkdown, setExternalMarkdown] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const editingRef = useRef(editing);
  const dirtyRef = useRef(false);
  const draftRef = useRef(draft);
  const digestRef = useRef(digest);
  const savingRef = useRef(saving);
  const saveBlockedRef = useRef(false);
  const autoEditKeyRef = useRef<string | null>(null);
  editingRef.current = editing;
  dirtyRef.current = editing && draft !== markdown;
  draftRef.current = draft;
  digestRef.current = digest;
  savingRef.current = saving;
  saveBlockedRef.current = conflictDigest !== null || externalChange;

  useEffect(() => {
    if (dirtyRef.current) {
      setExternalChange(true);
      return;
    }

    setError(false);

    void loadDocumentContent(doc)
      .then((loaded) => {
        setDigest(loaded.digest);
        setMarkdown(loaded.markdown);
        setHtml(renderMarkdown(loaded.markdown));
        const docKey = `${doc.id}:${doc.rel_path}`;
        if (
          editable &&
          !isFullHtmlDocument(loaded.markdown) &&
          autoEditKeyRef.current !== docKey
        ) {
          autoEditKeyRef.current = docKey;
          setDraft(loaded.markdown);
          setParseFallback(false);
          setSourceMode(false);
          setEditing(true);
        } else if (editingRef.current) {
          setDraft(loaded.markdown);
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(true);
      });

    // `doc` carries the registry's content digest, so a refetch that finds the
    // same bytes hands back the identical row and this effect does not run,
    // while an external rewrite hands back a new one and it does. That is what
    // makes a live document change reach an open tab: a clean viewer reloads,
    // and the dirty guard above keeps a draft and raises the external-change
    // flow instead of overwriting what someone is typing.
  }, [doc, editable]);

  useEffect(() => {
    if (focusSignal > 0) contentRef.current?.focus();
  }, [focusSignal]);

  function applyExternal(loaded: LoadedMarkdown): void {
    setDigest(loaded.digest);
    setMarkdown(loaded.markdown);
    setDraft(loaded.markdown);
    setHtml(renderMarkdown(loaded.markdown));
    setConflictDigest(null);
    setExternalChange(false);
    setExternalMarkdown(null);
    setSaveError(false);
  }

  async function reloadExternal(): Promise<void> {
    const confirmed = await dialog.confirm({
      title: "Reload external version?",
      body: "Your unsaved edits will be discarded and replaced with the version on disk.",
      confirmLabel: "Reload theirs",
      danger: true,
    });
    if (!confirmed) return;

    setLoadingExternal(true);
    try {
      applyExternal(await loadDocumentContent(doc));
    } catch {
      setSaveError(true);
    } finally {
      setLoadingExternal(false);
    }
  }

  async function compareExternal(): Promise<void> {
    setLoadingExternal(true);
    try {
      const loaded = await loadDocumentContent(doc);
      setExternalMarkdown(loaded.markdown);
      setSaveError(false);
    } catch {
      setSaveError(true);
    } finally {
      setLoadingExternal(false);
    }
  }

  // Saving never leaves edit mode: the editor is the document surface, so a
  // save just re-baselines the buffer against the freshly persisted bytes.
  async function persistDraft(
    expectedDigest = digest,
    content = draft,
  ): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      // One identity per save intent: a runtime that already made these bytes
      // durable replays that answer instead of writing them a second time.
      const saved = await saveDocument({
        documentId: doc.id,
        expectedDigest,
        content,
        operationId: newSaveOperationId(),
      });
      if (saved.stale) {
        // The draft stays exactly as it is; the digest is what a deliberate
        // overwrite would be applied against.
        setConflictDigest(saved.digest);
        return;
      }
      setDigest(saved.digest);
      setMarkdown(content);
      setHtml(renderMarkdown(content));
      setConflictDigest(null);
      setExternalChange(false);
      setExternalMarkdown(null);
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!editing) return;

    const timer = window.setInterval(() => {
      if (
        !dirtyRef.current ||
        savingRef.current ||
        saveBlockedRef.current
      ) {
        return;
      }
      void persistDraft(digestRef.current, draftRef.current);
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [editing, doc.id]);

  if (error) {
    return (
      <div className="h-full w-full bg-pane-bg p-6 text-sm text-lifecycle-danger" role="alert">
        Unable to load this document.
      </div>
    );
  }

  if (editing) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-pane-bg">
        <div
          className="sticky top-0 z-10 flex min-h-12 flex-none items-center gap-3 border-b border-pane-border bg-pane-title/95 px-3 py-2 shadow-sm"
          data-testid="document-editor-action-row"
        >
          <button
            type="button"
            disabled={saving || loadingExternal || draft === markdown}
            className="rounded-md border border-blue-600 bg-blue-600 px-2.5 py-1 text-xs text-white shadow-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={saving ? "Saving document" : "Save document"}
            onClick={() => void persistDraft()}
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
                  className="rounded-md border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent disabled:opacity-50"
                  aria-label="Reload theirs"
                  onClick={() => void reloadExternal()}
                >
                  Reload theirs
                </button>
                <button
                  type="button"
                  disabled={saving || loadingExternal}
                  className="rounded-md border border-lifecycle-attention bg-lifecycle-attention/15 px-2.5 py-1 text-xs text-lifecycle-attention hover:bg-lifecycle-attention/25 disabled:opacity-50"
                  aria-label="Overwrite with mine"
                  onClick={() => void persistDraft(conflictDigest)}
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
                  className="rounded-md border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent disabled:opacity-50"
                  aria-label="Reload external version"
                  onClick={() => void reloadExternal()}
                >
                  Reload
                </button>
                <button
                  type="button"
                  disabled={saving || loadingExternal}
                  className="rounded-md border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent disabled:opacity-50"
                  aria-label="Compare versions"
                  onClick={() => void compareExternal()}
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
            className="rounded-md border border-pane-border bg-pane-panel/95 px-2.5 py-1 text-xs text-text-primary shadow-md hover:border-focus-accent"
            aria-label="Cancel editing"
            onClick={() => {
              setDraft(markdown);
              setSaveError(false);
              setConflictDigest(null);
              setExternalChange(false);
              setExternalMarkdown(null);
              setEditing(false);
            }}
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
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-pane-border bg-pane-panel p-3 text-xs text-text-primary">
                  {draft}
                </pre>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  On disk
                </h3>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-pane-border bg-pane-panel p-3 text-xs text-text-primary">
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
                  className="min-h-[60vh] w-full resize-y rounded-lg border border-pane-border bg-pane-panel p-4 font-mono text-sm text-text-primary focus:border-focus-accent focus:outline-none"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
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
                  onChange={setDraft}
                  onParseError={(source) => {
                    setDraft(source);
                    setParseFallback(true);
                    setSourceMode(true);
                  }}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-auto bg-pane-bg">
      {editable ? (
        <button
          type="button"
          onClick={() => {
            setDraft(markdown);
            setSaveError(false);
            setConflictDigest(null);
            setExternalChange(false);
            setExternalMarkdown(null);
            setParseFallback(false);
            setSourceMode(isFullHtmlDocument(markdown));
            setEditing(true);
          }}
          className="absolute right-36 top-3 z-10 rounded-md border border-pane-border bg-pane-panel/95 px-2.5 py-1 text-xs text-text-primary shadow-md hover:border-focus-accent"
          aria-label={
            isFullHtmlDocument(markdown) ? "Edit document source" : "Edit document"
          }
        >
          Edit
        </button>
      ) : null}
      <div
        ref={contentRef}
        tabIndex={-1}
        className="prose prose-invert mx-auto max-w-4xl px-8 py-10 focus:outline-none"
        dangerouslySetInnerHTML={{ __html: html }}
        data-testid="markdown-document"
      />
    </div>
  );
}
