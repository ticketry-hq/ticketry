import { Suspense, useEffect, useRef, useState } from "react";
import { IconPencil } from "../../shared/ui/icons";
import { htmlToMarkdown, renderMarkdown, sanitizeHtml } from "./markdown";
import {
  acceptDescriptionVersion, discardDescriptionDraft, editDescriptionDraft,
  openDescriptionDraft, saveDescriptionDraft, useDescriptionDrafts,
} from "./descriptionDrafts";

import {
  LazyRichMarkdownEditor as RichMarkdownEditor,
  warmRichMarkdownEditorAfterPaint,
} from "./richMarkdownEditorLoader";

import { useTaskDetailCommit } from "../../shared/utilities/useTaskDetailCommit";
import { taskDetailPoint } from "../../shared/utilities/taskDetailProbe";
import { useClientStore } from "../../state/clientStore";

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

// Ticket descriptions are Markdown-backed. Legacy HTML remains readable and
// is normalized to Markdown the first time it is edited and saved.
//
// A dirty draft is written at every editor boundary (CODING-1525): Save,
// focus leaving the editor, and unmount (the parent keys this editor by
// Story id, so switching Stories unmounts it). Cancel is the only discard.
//
// `value` is the authoritative server row. While editing, a server value that
// differs from the draft's baseline is an external change (CODING-1527): the
// draft stays put behind a notice offering to keep it or load the server
// version. The two are never merged.
export default function DescriptionEditor({
  issueId,
  value,
  onSave,
  detailsVisible = true,
}: {
  issueId: string;
  value: string | null;
  onSave: (v: string) => Promise<unknown>;
  /** The Details tab can stay mounted while a different workspace tab is shown. */
  detailsVisible?: boolean;
}) {
  const moduleId = useClientStore((state) => state.selectedModuleId);
  useTaskDetailCommit(issueId, moduleId, "description", detailsVisible);
  useEffect(warmRichMarkdownEditorAfterPaint, []);
  const stored = useDescriptionDrafts((state) => state.drafts[issueId]);
  const { editing = false, text: draft = "", error = null } = stored ?? {};
  const saving = Boolean(stored?.requestId);
  const baseline = stored?.savingText ?? stored?.savedText ?? "";
  const setDraft = (text: string) => editDescriptionDraft(issueId, text);
  const [sourceFallback, setSourceFallback] = useState(false);
  // Markdown form of the latest server row seen while editing; null once the
  // person has chosen what to do about it.
  const [serverMarkdown, setServerMarkdown] = useState<string | null>(null);
  // Bumped when the draft is replaced wholesale so the rich editor remounts.
  const [generation, setGeneration] = useState(0);
  const latestSave = useRef(onSave);
  latestSave.current = onSave;

  const storedAsMarkdown = async (description: string) =>
    looksLikeHtml(description) ? htmlToMarkdown(description) : description;
  const storedAsHtml = (description: string) => {
    const started = performance.now();
    const html = looksLikeHtml(description) ? sanitizeHtml(description) : renderMarkdown(description);
    taskDetailPoint(issueId)("description-formatted", {
      format_ms: performance.now() - started, description_characters: description.length,
    });
    return html;
  };

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void storedAsMarkdown(value ?? "").then((markdown) => {
      if (!cancelled) setServerMarkdown(markdown);
    });
    return () => {
      cancelled = true;
    };
  }, [editing, value]);

  useEffect(
    () => () => {
      void saveDescriptionDraft(issueId, latestSave.current, true);
    },
    [issueId],
  );

  if (!editing) {
    const startEditing = async () => {
      const markdown = value ? await storedAsMarkdown(value) : "";
      openDescriptionDraft(issueId, markdown);
      setSourceFallback(false);
    };

    return (
      <div
        className={`min-h-[48px] cursor-text px-2 py-1.5 text-base leading-relaxed text-text-primary transition-colors ${
          value
            ? "border border-transparent hover:border-pane-border"
            : "border border-dashed border-pane-border hover:border-focus-accent"
        }`}
        onClick={() => {
          taskDetailPoint(issueId)("description-edit-click");
          void startEditing();
        }}
        data-testid="issue-description"
        ref={(element) => {
          if (element && detailsVisible) taskDetailPoint(issueId)("description-view-click-surface-mounted");
        }}
      >
        {saving && <span className="float-right text-xs text-text-muted">saving…</span>}
        {value ? (
          <div
            className="md-body"
            dangerouslySetInnerHTML={{ __html: storedAsHtml(value) }}
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <IconPencil size={13} />
            Add a description…
          </span>
        )}
      </div>
    );
  }

  const write = () => saveDescriptionDraft(issueId, onSave);

  // Save closes the editor at once; the write settles behind the view.
  const commit = () => {
    void saveDescriptionDraft(issueId, onSave, true);
  };

  const discard = () => {
    discardDescriptionDraft(issueId);
  };

  const externalChange =
    serverMarkdown !== null && serverMarkdown.trim() !== baseline.trim();

  const keepDraft = () => {
    acceptDescriptionVersion(issueId, serverMarkdown ?? baseline, false);
    setServerMarkdown(null);
  };

  const loadServerVersion = () => {
    const markdown = serverMarkdown ?? "";
    acceptDescriptionVersion(issueId, markdown, true);
    setGeneration((current) => current + 1);
    setServerMarkdown(null);
  };

  return (
    <div
      data-testid="description-editor"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void write();
      }}
    >
      {sourceFallback ? (
        <div>
          <p className="mb-2 text-xs text-lifecycle-attention" role="status">
            Rich editing is unavailable for this description. Editing the
            Markdown source instead.
          </p>
          <textarea
            autoFocus
            aria-label="Ticket description source"
            className="min-h-[12rem] w-full resize-y border border-pane-border bg-pane-panel p-3 font-mono text-base text-text-primary focus:border-focus-accent focus:outline-none"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            ref={(element) => {
              if (element && detailsVisible && !element.disabled) {
                taskDetailPoint(issueId)("description-editor-fallback-editable");
              }
            }}
          />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="p-3 text-sm text-text-muted" role="status">
              Loading editor…
            </div>
          }
        >
          <RichMarkdownEditor
            key={generation}
            markdown={draft}
            onChange={setDraft}
            onParseError={(source) => {
              setDraft(source);
              setSourceFallback(true);
            }}
            onEditableReady={detailsVisible
              ? () => taskDetailPoint(issueId)("description-editor-rich-editable")
              : undefined}
            onTrustedFocus={() => taskDetailPoint(issueId)("description-editor-focus-observed")}
            onTrustedInput={() => taskDetailPoint(issueId)("description-editor-first-trusted-input")}
            layout="compact"
          />
        </Suspense>
      )}

      {externalChange && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2"
          role="status"
          data-testid="description-external-change"
          onMouseDown={(event) => event.preventDefault()}
        >
          <span className="text-xs font-medium text-lifecycle-attention">
            This description changed on the server. Your draft is still here.
          </span>
          <button
            type="button"
            onClick={keepDraft}
            className="border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent"
          >
            Keep my draft
          </button>
          <button
            type="button"
            onClick={loadServerVersion}
            className="border border-pane-border bg-pane-panel px-2.5 py-1 text-xs text-text-primary hover:border-focus-accent"
          >
            Load the server version
          </button>
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-lifecycle-danger" role="alert">
          Description not saved: {error}
        </p>
      )}

      {/* Pressing a button must not blur the editor first (WebKit leaves relatedTarget null). */}
      <div className="mt-1.5 flex items-center gap-2" onMouseDown={(event) => event.preventDefault()}>
        <button
          type="button"
          onClick={commit}
          className="bg-focus-accent px-2.5 py-1 text-xs font-semibold text-pane-bg"
        >
          Save
        </button>
        <button
          type="button"
          onClick={discard}
          className="border border-pane-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
        {saving && <span className="text-xs text-text-muted">saving…</span>}
      </div>
    </div>
  );
}
