import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { isTerminalProvider, type TerminalProvider } from "../../agents/terminal";
import { startInstantChangeFlow } from "../../studio/modals/PlanFeature";
import { providerListPlaceholder, useActivatedProviders } from "../../workflows";
import { useConversationComposerStore } from "./conversationComposerStore";

const DEFAULT_PROVIDER = "";

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Inline "start a conversation with this prompt" field under Conversations. */
export function ConversationComposer() {
  const closeComposer = useConversationComposerStore((s) => s.closeComposer);
  const [draft, setDraft] = useState(
    () => useConversationComposerStore.getState().draft,
  );
  const [provider, setProvider] = useState<TerminalProvider | "">(DEFAULT_PROVIDER);
  const activated = useActivatedProviders();
  const providers = [...activated.slugs].filter(isTerminalProvider);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const prompt = draft.trim();

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    // Closing keeps the typed prompt for the next open instead of losing it.
    return () => useConversationComposerStore.getState().setDraft(draftRef.current);
  }, []);

  useLayoutEffect(() => {
    draftRef.current = draft;
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [draft]);

  function start(): void {
    if (!prompt) return;
    draftRef.current = "";
    closeComposer();
    startInstantChangeFlow({ prompt, provider: provider || undefined });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeComposer();
      return;
    }
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.stopPropagation();
      start();
      return;
    }
    // Arrows and plain Enter edit the prompt; the tree must not claim them.
    if (event.key.startsWith("Arrow") || event.key === "Enter") {
      event.stopPropagation();
    }
  }

  return (
    <li
      role="none"
      data-conversation-composer
      onKeyDown={handleKeyDown}
      className="my-1 ml-5 mr-1 border border-focus-accent bg-pane-bg shadow-[0_0_0_2px_rgba(122,162,247,0.25)]"
    >
      <textarea
        ref={inputRef}
        aria-label="First message for the new conversation"
        rows={2}
        value={draft}
        placeholder="Ask anything. The agent runs in this module's folder…"
        onChange={(event) => setDraft(event.target.value)}
        className="block min-h-12 w-full resize-none overflow-hidden bg-transparent px-2 py-1 text-sm leading-5 text-text-primary caret-focus-accent outline-none placeholder:text-text-muted"
      />
      <div className="flex items-center gap-2 px-2 pb-1.5">
        <select
          aria-label="Agent for the new conversation"
          value={provider}
          onChange={(event) =>
            setProvider(event.target.value as TerminalProvider | "")
          }
          className="border border-pane-border bg-pane-bg px-1 text-xs text-text-secondary outline-none hover:border-focus-accent focus-visible:border-focus-accent"
        >
          <option value={DEFAULT_PROVIDER}>Default agent</option>
          {providers.map((slug) => (
            <option key={slug} value={slug}>
              {providerLabel(slug)}
            </option>
          ))}
        </select>
        {providers.length === 0 ? (
          <span className="min-w-0 truncate text-xs text-text-muted" title={providerListPlaceholder(activated)}>
            {providerListPlaceholder(activated)}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-xs text-text-muted">
          ⌘↵ start · Esc close
        </span>
        <button
          type="button"
          disabled={!prompt}
          title={prompt ? undefined : "Type a message to start"}
          onClick={start}
          className="border border-focus-accent px-2 text-xs text-focus-accent hover:bg-pane-title disabled:cursor-not-allowed disabled:border-pane-border disabled:text-text-muted disabled:hover:bg-transparent"
        >
          Start
        </button>
      </div>
    </li>
  );
}
