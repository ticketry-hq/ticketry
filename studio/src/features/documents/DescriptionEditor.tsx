import { lazy, Suspense, useRef, useState } from "react";
import { IconPencil } from "../../shared/ui/icons";
import { htmlToMarkdown, markdownToHtml, renderMarkdown, sanitizeHtml } from "./markdown";

const RichMarkdownEditor = lazy(() => import("./RichMarkdownEditor"));

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

// Ticket descriptions remain HTML-backed: reading is sanitized, editing is
// Markdown, and saving renders the draft back through `description_html`.
export default function DescriptionEditor({
  html,
  onSave,
  format = "html",
}: {
  html: string | null;
  onSave: (v: string) => void;
  format?: "html" | "markdown";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sourceFallback, setSourceFallback] = useState(false);
  const initial = useRef("");

  const storedAsMarkdown = async (value: string) =>
    format === "markdown" || !looksLikeHtml(value)
      ? value
      : htmlToMarkdown(value);
  const storedAsHtml = (value: string) =>
    format === "markdown" || !looksLikeHtml(value)
      ? renderMarkdown(value)
      : sanitizeHtml(value);

  if (!editing) {
    const startEditing = async () => {
      const markdown = html ? await storedAsMarkdown(html) : "";
      initial.current = markdown;
      setDraft(markdown);
      setSourceFallback(false);
      setEditing(true);
    };

    return (
      <div
        className={`min-h-[48px] cursor-text rounded-md px-2 py-1.5 text-base leading-relaxed text-text-primary transition-colors ${
          html
            ? "border border-transparent hover:border-pane-border"
            : "border border-dashed border-pane-border hover:border-focus-accent"
        }`}
        onClick={() => void startEditing()}
        data-testid="issue-description"
      >
        {html ? (
          <div
            className="md-body"
            dangerouslySetInnerHTML={{ __html: storedAsHtml(html) }}
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

  const commit = () => {
    setEditing(false);
    if (draft === initial.current) return;

    const markdown = draft.trim();
    onSave(
      format === "markdown"
        ? markdown
        : markdown
          ? markdownToHtml(markdown)
          : "",
    );
  };

  return (
    <div data-testid="description-editor">
      {sourceFallback ? (
        <div>
          <p className="mb-2 text-xs text-lifecycle-attention" role="status">
            Rich editing is unavailable for this description. Editing the
            Markdown source instead.
          </p>
          <textarea
            autoFocus
            aria-label="Ticket description source"
            className="min-h-[12rem] w-full resize-y rounded-lg border border-pane-border bg-pane-panel p-3 font-mono text-sm text-text-primary focus:border-focus-accent focus:outline-none"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
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
            markdown={draft}
            onChange={setDraft}
            onParseError={(source) => {
              setDraft(source);
              setSourceFallback(true);
            }}
            layout="compact"
          />
        </Suspense>
      )}

      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={commit}
          className="rounded bg-focus-accent px-2.5 py-1 text-xs font-semibold text-pane-bg"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded border border-pane-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
