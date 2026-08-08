/**
 * Plain-turn composer adapted from `pingdotgg/t3code`
 * `apps/web/src/components/chat/ChatComposer.tsx`,
 * `apps/web/src/components/ComposerPromptEditor.tsx`, and
 * `apps/web/src/composer-logic.ts` at revision
 * 45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b (MIT; see
 * `third_party/t3code/LICENSE`). Mentions and attachments remain later slices;
 * Enter/Shift+Enter, durable drafts, busy state, and stop semantics are kept.
 */

import { useEffect, useRef, useState } from "react";
import type { ChatConnectionState, ChatSessionStatus } from "./types";
import { isChatDeliveryUnknownError } from "./transport";

export function shouldSubmitComposerOnEnter(input: {
  isMobileViewport: boolean;
  shiftKey: boolean;
}): boolean {
  return !input.isMobileViewport && !input.shiftKey;
}

function draftKey(agentRunId: string): string {
  return `ticketry.chat-draft:${agentRunId}:v1`;
}

function readDraft(agentRunId: string): string {
  try {
    return localStorage.getItem(draftKey(agentRunId)) ?? "";
  } catch {
    return "";
  }
}

function persistDraft(agentRunId: string, value: string): void {
  try {
    if (value) localStorage.setItem(draftKey(agentRunId), value);
    else localStorage.removeItem(draftKey(agentRunId));
  } catch {
    /* Draft persistence is optional when storage is unavailable. */
  }
}

export function ChatComposer({
  agentRunId,
  status,
  connection,
  retryableError = false,
  processEnded = false,
  deliveryUncertain = false,
  deliveryReviewRequired = false,
  onSend,
  onInterrupt,
}: {
  agentRunId: string;
  status: ChatSessionStatus;
  connection: ChatConnectionState;
  retryableError?: boolean;
  processEnded?: boolean;
  deliveryUncertain?: boolean;
  deliveryReviewRequired?: boolean;
  onSend: (prompt: string) => Promise<void>;
  onInterrupt: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(() => readDraft(agentRunId));
  const [busy, setBusy] = useState<"send" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const running = status === "running";
  const sessionClosed = status === "stopped" || processEnded;
  const canSend = prompt.trim().length > 0 && !busy && !running &&
    !sessionClosed && !deliveryUncertain;

  useEffect(() => {
    setPrompt(readDraft(agentRunId));
    setError(null);
  }, [agentRunId]);

  useEffect(() => {
    persistDraft(agentRunId, prompt);
  }, [agentRunId, prompt]);

  async function submit(): Promise<void> {
    const value = prompt.trim();
    if (!value || busy || running || sessionClosed || deliveryUncertain) return;
    setBusy("send");
    setError(null);
    setPrompt("");
    try {
      await onSend(value);
    } catch (reason) {
      if (isChatDeliveryUnknownError(reason)) {
        setError("Delivery is unconfirmed. Check the transcript before retrying.");
      } else {
        setPrompt((current) => current || value);
        setError(reason instanceof Error ? reason.message : "Could not send the message");
      }
    } finally {
      setBusy(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function interrupt(): Promise<void> {
    if (busy || !running) return;
    setBusy("stop");
    setError(null);
    try {
      await onInterrupt();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not stop the response");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      data-testid="chat-composer"
      className="border-t border-pane-border bg-pane-panel/95 px-3 pb-3 pt-2"
    >
      {error ? (
        <p role="alert" className="mb-2 text-xs text-lifecycle-danger">
          {error}
        </p>
      ) : null}
      <div className="rounded-lg border border-pane-border bg-pane-bg shadow-sm focus-within:border-focus-accent">
        <textarea
          ref={textareaRef}
          aria-label="Message Codex"
          rows={3}
          value={prompt}
          disabled={sessionClosed}
          placeholder={
            sessionClosed
              ? "This Chat session has ended"
              : status === "error" && retryableError
                ? "Retry with another message…"
              : running
                ? "Codex is working…"
                : "Ask Codex about this codebase…"
          }
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            const mobile = typeof window.matchMedia === "function" &&
              window.matchMedia("(max-width: 640px)").matches;
            if (!shouldSubmitComposerOnEnter({
              isMobileViewport: mobile,
              shiftKey: event.shiftKey,
            })) return;
            event.preventDefault();
            void submit();
          }}
          className="block min-h-[4.75rem] w-full resize-none bg-transparent px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3 border-t border-pane-border px-2 py-1.5">
          <span className="truncate text-xs text-text-muted">
            {deliveryReviewRequired
              ? "Review the resumed thread before continuing"
              : deliveryUncertain
                ? "Waiting to confirm prior message delivery"
              : connection === "reconnecting"
                ? "Reconnecting — sends use the durable API"
              : "Enter to send · Shift+Enter for newline"}
          </span>
          {running ? (
            <button
              type="button"
              onClick={() => void interrupt()}
              disabled={busy !== null}
              className="shrink-0 rounded border border-lifecycle-danger/60 px-3 py-1 text-xs font-semibold text-lifecycle-danger hover:bg-lifecycle-danger/10 disabled:opacity-50"
            >
              {busy === "stop" ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSend}
              className="shrink-0 rounded bg-focus-accent px-3 py-1 text-xs font-semibold text-pane-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "send" ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
