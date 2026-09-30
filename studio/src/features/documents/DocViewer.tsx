import { useCallback, useEffect, useRef, useState } from "react";
import { dialog } from "../../state/clientStore";
import { newSaveOperationId, saveDocument } from "./documentSave";
import { HtmlDocumentViewer } from "./HtmlDocumentViewer";
import { MarkdownDocumentEditor } from "./MarkdownDocumentEditor";
import type { DesignDoc } from "./types";
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
  return <HtmlDocumentViewer doc={doc} focusSignal={focusSignal} />;
}

export function isFullHtmlDocument(source: string): boolean {
  const trimmed = source.replace(/^\uFEFF/, "").trim();
  const withoutPreamble = trimmed
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "")
    .replace(/^<!doctype\s+html(?:\s[^>]*)?>\s*/i, "");

  return /^<html(?:\s[^>]*)?>[\s\S]*<\/html>\s*$/i.test(withoutPreamble);
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
  const loadGenerationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  editingRef.current = editing;
  dirtyRef.current = editing && draft !== markdown;
  draftRef.current = draft;
  digestRef.current = digest;
  savingRef.current = saving;
  saveBlockedRef.current = conflictDigest !== null || externalChange;

  const loadLatestDocument = useCallback(async (): Promise<LoadedMarkdown | null> => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const loaded = await loadDocumentContent(
      { id: doc.id, rel_path: doc.rel_path },
      controller.signal,
    );
    return generation === loadGenerationRef.current ? loaded : null;
  }, [doc.id, doc.rel_path]);

  useEffect(() => {
    if (dirtyRef.current) {
      saveBlockedRef.current = true;
      setExternalChange(true);
      return;
    }

    setError(false);

    void loadLatestDocument()
      .then((loaded) => {
        if (!loaded) return;
        if (dirtyRef.current) {
          saveBlockedRef.current = true;
          setExternalChange(true);
          return;
        }
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

    return () => loadControllerRef.current?.abort();
  }, [doc.content_digest, doc.id, doc.rel_path, editable, loadLatestDocument]);

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
      const loaded = await loadLatestDocument();
      if (loaded) applyExternal(loaded);
    } catch {
      setSaveError(true);
    } finally {
      setLoadingExternal(false);
    }
  }

  async function compareExternal(): Promise<void> {
    setLoadingExternal(true);
    try {
      const loaded = await loadLatestDocument();
      if (loaded) setExternalMarkdown(loaded.markdown);
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
    explicit = true,
  ): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      if (!explicit) {
        const latest = await loadLatestDocument();
        if (!latest) return;
        if (latest.digest !== expectedDigest) {
          saveBlockedRef.current = true;
          setExternalChange(true);
          return;
        }
      }
      // One identity per save intent: a runtime that already made these bytes
      // durable replays that answer instead of writing them a second time.
      const saved = await saveDocument({
        documentId: doc.id,
        expectedDigest,
        content,
        operationId: newSaveOperationId(),
      });
      if (saved.stale) {
        // An automatic save never asks for overwrite confirmation. It exposes
        // the external version first so the person can compare or reload it.
        // An explicit save keeps the returned digest for a deliberate retry.
        if (explicit) setConflictDigest(saved.digest);
        else setExternalChange(true);
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
      void persistDraft(digestRef.current, draftRef.current, false);
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
      <MarkdownDocumentEditor
        doc={doc}
        digest={digest}
        draft={draft}
        markdown={markdown}
        conflictDigest={conflictDigest}
        externalChange={externalChange}
        externalMarkdown={externalMarkdown}
        loadingExternal={loadingExternal}
        parseFallback={parseFallback}
        saveError={saveError}
        saving={saving}
        sourceMode={sourceMode}
        onCancel={() => {
          setDraft(markdown);
          setSaveError(false);
          setConflictDigest(null);
          setExternalChange(false);
          setExternalMarkdown(null);
          setEditing(false);
        }}
        onCompare={() => void compareExternal()}
        onDraftChange={setDraft}
        onOverwrite={(nextDigest) => void persistDraft(nextDigest)}
        onParseError={(source) => {
          setDraft(source);
          setParseFallback(true);
          setSourceMode(true);
        }}
        onReload={() => void reloadExternal()}
        onSave={() => void persistDraft()}
      />
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
          className="absolute right-36 top-3 z-10 border border-pane-border bg-pane-panel/95 px-2.5 py-1 text-xs text-text-primary shadow-md hover:border-focus-accent"
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
