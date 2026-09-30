import { Suspense, useEffect, useRef, useState } from "react";
import { IconPencil } from "../../shared/ui/icons";
import { htmlToMarkdown, renderMarkdown, sanitizeHtml } from "./markdown";
import {
  acceptDescriptionVersion, editDescriptionDraft,
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
// The editor is always live; there is no separate read view. A dirty draft is
// written shortly after typing pauses, when focus leaves the editor, and on
// unmount (the parent keys this editor by Story id, so switching Stories
// unmounts it) (CODING-1525).
//
// `value` is the authoritative server row. A clean draft follows it. A dirty
// draft whose baseline differs from it is an external change (CODING-1527):
// the draft stays put behind a notice offering to keep it or load the server
// version, and autosave waits for that choice. The two are never merged.
const AUTOSAVE_DELAY_MS = 800;

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
  // The rich editor mounts once its code has loaded after the first paint.
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => warmRichMarkdownEditorAfterPaint(() => setEditorReady(true)), []);
  const stored = useDescriptionDrafts((state) => state.drafts[issueId]);
  const { text: draft = "", error = null } = stored ?? {};
  const saving = Boolean(stored?.requestId);
  const dirty = stored ? stored.text !== stored.savedText : false;
  const baseline = stored?.savingText ?? stored?.savedText ?? "";
  const setDraft = (text: string) => editDescriptionDraft(issueId, text);
  const [sourceFallback, setSourceFallback] = useState(false);
  // Markdown form of a server row that differs from a dirty draft's baseline;
  // null once the person has chosen what to do about it.
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
    let cancelled = false;
    void storedAsMarkdown(value ?? "").then((markdown) => {
      if (cancelled) return;
      openDescriptionDraft(issueId, markdown);
      const current = useDescriptionDrafts.getState().drafts[issueId];
      if (!current || markdown.trim() === (current.savingText ?? current.savedText).trim()) return;
      if (!current.requestId && current.text === current.savedText) {
        acceptDescriptionVersion(issueId, markdown, true);
        setGeneration((count) => count + 1);
      } else {
        setServerMarkdown(markdown);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [issueId, value]);

  useEffect(
    () => () => {
      void saveDescriptionDraft(issueId, latestSave.current, true);
    },
    [issueId],
  );

  const externalChange =
    serverMarkdown !== null && serverMarkdown.trim() !== baseline.trim();

  useEffect(() => {
    if (!dirty || externalChange) return;
    const timer = setTimeout(() => {
      void saveDescriptionDraft(issueId, latestSave.current);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [issueId, draft, dirty, externalChange]);

  // Shown until the draft opens and while the rich editor loads, so the text never flashes.
  const rendered = (
    <div
      className="min-h-[48px] cursor-text px-2 py-1.5 text-base leading-relaxed text-text-primary"
      onClick={() => setEditorReady(true)}
    >
      {value ? (
        <div className="md-body" dangerouslySetInnerHTML={{ __html: storedAsHtml(value) }} />
      ) : (
        <span className="inline-flex items-center gap-1.5 text-text-muted">
          <IconPencil size={13} />
          Add a description…
        </span>
      )}
    </div>
  );

  if (!stored || !editorReady) return <div data-testid="issue-description">{rendered}</div>;

  const write = () => {
    if (!externalChange) void saveDescriptionDraft(issueId, onSave);
  };

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

  const statusLabel = saving && (
    <span className={`text-xs text-text-muted ${sourceFallback ? "mt-1.5 block" : ""}`} aria-live="polite">
      Saving…
    </span>
  );

  return (
    <div
      data-testid="issue-description"
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
        <Suspense fallback={rendered}>
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
            quietUntilFocused
            toolbarActions={statusLabel}
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

      {sourceFallback && statusLabel}
    </div>
  );
}
