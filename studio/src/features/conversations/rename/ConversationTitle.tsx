import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { renameInstantConversation } from "./renameInstantConversation";

interface ConversationTitleProps {
  agentRunId: string;
  title: string;
  selected: boolean;
  untitled: boolean;
}

/** A selected conversation's name is also its inline rename control. */
export function ConversationTitle({ agentRunId, title, selected, untitled }: ConversationTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const activeEdit = useRef(false);
  const pending = useRef(false);
  const errorId = useId();
  const titleClass = `truncate ${untitled ? "italic text-text-secondary" : ""}`;

  useEffect(() => {
    if (!selected) {
      restoreFocus.current = false;
      activeEdit.current = false;
      setEditing(false);
      setError(null);
    }
  }, [selected, agentRunId]);

  useLayoutEffect(() => {
    if (editing || saving || !selected || !restoreFocus.current) return;
    restoreFocus.current = false;
    button.current?.focus({ preventScroll: true });
  }, [editing, saving, selected]);

  useEffect(() => {
    if (!editing) return;
    input.current?.focus({ preventScroll: true });
    input.current?.select();
    return () => { activeEdit.current = false; };
  }, [editing]);

  function cancel(keyboard = false) {
    if (pending.current) return;
    restoreFocus.current = keyboard && document.activeElement === input.current;
    activeEdit.current = false;
    setEditing(false);
    setError(null);
  }

  async function save(keyboard = false) {
    if (!activeEdit.current || pending.current) return;
    const name = draft.trim();
    if (!name) {
      setError("A conversation title is required.");
      return;
    }
    if (name === title) {
      cancel(keyboard);
      return;
    }
    pending.current = true;
    restoreFocus.current = keyboard && document.activeElement === input.current;
    setSaving(true);
    setError(null);
    try {
      await renameInstantConversation(agentRunId, name);
      restoreFocus.current = restoreFocus.current && activeEdit.current && document.activeElement === input.current;
      activeEdit.current = false;
      setEditing(false);
    } catch (failure) {
      if (activeEdit.current) {
        setError(failure instanceof Error ? failure.message : "The conversation could not be renamed.");
      }
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <input
          ref={input}
          aria-label="Conversation title"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-busy={saving}
          value={draft}
          readOnly={saving}
          onChange={(event) => { setDraft(event.target.value); setError(null); }}
          onBlur={() => { restoreFocus.current = false; void save(); }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); cancel(true); }
            if (event.key === "Enter") { event.preventDefault(); void save(true); }
          }}
          className="w-full min-w-0 border border-focus-accent bg-pane-bg px-1 text-text-primary outline-none"
        />
        {error ? <span id={errorId} role="alert" className="block text-xs text-red-400">{error}</span> : null}
      </span>
    );
  }

  return selected ? (
    <button
      ref={button}
      type="button"
      aria-label={`Rename conversation: ${title}`}
      disabled={saving}
      title="Rename conversation"
      data-task-name
      data-conversation-rename
      className={`${titleClass} min-w-0 text-left hover:underline focus-visible:outline focus-visible:outline-focus-accent`}
      onClick={(event) => {
        event.stopPropagation();
        if (pending.current) return;
        activeEdit.current = true;
        setDraft(title);
        setError(null);
        setEditing(true);
      }}
    >{title}</button>
  ) : <span data-task-name className={titleClass}>{title}</span>;
}
