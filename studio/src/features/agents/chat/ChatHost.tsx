import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatPendingRequests } from "./ChatPendingRequests";
import { MessagesTimeline } from "./MessagesTimeline";
import { useChatStore } from "./store";
import { deriveChatTimelineRows } from "./timeline";
import {
  canResumeChatSession,
  chatProcessHasEnded,
  unresolvedChatDeliveryUnknown,
  unresolvedChatMessageSend,
} from "./eventSemantics";
import {
  acquireChatConnection,
  interruptChat,
  respondToChatApproval,
  respondToChatUserInput,
  resumeChat,
  retryUnknownChatTurn,
  startChatTurn,
  stopChat,
} from "./transport";
import type { ChatConnectionState, ChatSessionStatus } from "./types";

function statusLabel(status: ChatSessionStatus): string {
  switch (status) {
    case "starting": return "Starting";
    case "ready": return "Ready";
    case "running": return "Working";
    case "interrupted": return "Stopped response";
    case "stopped": return "Session ended";
    case "error": return "Error";
  }
}

function connectionLabel(connection: ChatConnectionState): string | null {
  switch (connection) {
    case "connecting": return "Connecting";
    case "reconnecting": return "Reconnecting";
    case "error": return "Connection error";
    default: return null;
  }
}

export function ChatHost({
  agentRunId,
  focusSignal = 0,
}: {
  agentRunId: string;
  focusSignal?: number;
}) {
  const session = useChatStore((state) => state.sessions[agentRunId]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [expandedTurnIds, setExpandedTurnIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [ending, setEnding] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewedUnknownDelivery, setReviewedUnknownDelivery] = useState<string | null>(null);
  const rows = useMemo(
    () => session
      ? deriveChatTimelineRows({
          events: session.events,
          pendingUserMessages: session.pending_user_messages,
          status: session.status,
          activeTurnId: session.active_turn_id,
          expandedTurnIds,
        })
      : [],
    [expandedTurnIds, session],
  );

  useEffect(() => acquireChatConnection(agentRunId), [agentRunId]);

  useEffect(() => {
    if (focusSignal > 0) rootRef.current?.focus({ preventScroll: true });
  }, [focusSignal]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Loading Chat session…
      </div>
    );
  }

  const transportLabel = connectionLabel(session.connection);
  const hasConversation = rows.some((row) => row.kind !== "working");
  const canResume = canResumeChatSession({
    status: session.status,
    events: session.events,
    retryableError: session.retryable_error,
    runStatus: session.run_status,
  });
  const processEnded = chatProcessHasEnded({
    status: session.status,
    runStatus: session.run_status,
    endedAt: session.ended_at,
  });
  const pendingDeliveryUncertain = session.pending_user_messages.some(
    (message) => message.delivery === "unknown",
  );
  const durablePendingDelivery = unresolvedChatMessageSend(session.events);
  const durableUnknownDelivery = unresolvedChatDeliveryUnknown(session.events);
  const durableUnknownKey = durableUnknownDelivery
    ? `${durableUnknownDelivery.sequence}:${durableUnknownDelivery.id}`
    : null;
  const deliveryReviewRequired = durableUnknownKey !== null &&
    reviewedUnknownDelivery !== durableUnknownKey;
  const deliveryUncertain = pendingDeliveryUncertain ||
    durablePendingDelivery !== null ||
    deliveryReviewRequired;
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid={`chat-host-${agentRunId}`}
      className="flex h-full min-h-0 flex-col bg-pane-bg outline-none"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-pane-border bg-pane-panel px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">Codex Chat</span>
            <span className="rounded border border-pane-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
              {statusLabel(session.status)}
            </span>
          </div>
          <div className="truncate font-mono text-[10px] text-text-muted">
            {agentRunId}
          </div>
        </div>
        {transportLabel ? (
          <span className="ml-auto text-xs text-lifecycle-attention">
            {transportLabel}…
          </span>
        ) : <span className="ml-auto" />}
        {canResume ? (
          <button
            type="button"
            disabled={resuming}
            onClick={() => {
              setResuming(true);
              setActionError(null);
              void resumeChat(agentRunId)
                .catch((error: unknown) => {
                  setActionError(
                    error instanceof Error ? error.message : "Could not resume Chat",
                  );
                })
                .finally(() => setResuming(false));
            }}
            className="shrink-0 rounded border border-focus-accent/60 px-2 py-1 text-xs font-semibold text-focus-accent hover:bg-focus-accent/10 disabled:opacity-50"
          >
            {resuming ? "Resuming…" : "Resume"}
          </button>
        ) : null}
        {session.status !== "stopped" && !canResume && !processEnded ? (
          <button
            type="button"
            disabled={ending}
            onClick={() => {
              setEnding(true);
              setActionError(null);
              void stopChat(agentRunId)
                .catch((error: unknown) => {
                  setActionError(
                    error instanceof Error ? error.message : "Could not end Chat",
                  );
                })
                .finally(() => setEnding(false));
            }}
            className="shrink-0 text-xs text-text-muted hover:text-lifecycle-danger disabled:opacity-50"
          >
            {ending ? "Ending…" : "End session"}
          </button>
        ) : null}
      </header>

      {actionError || session.transport_error || session.last_error ? (
        <div role="alert" className="shrink-0 border-b border-lifecycle-danger/30 bg-lifecycle-danger/10 px-3 py-2 text-xs text-lifecycle-danger">
          {actionError ?? session.transport_error ?? session.last_error}
        </div>
      ) : null}

      {!hasConversation && session.status !== "running" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <div>
            <div className="mb-1 text-sm font-semibold text-text-primary">
              Chat with Codex about this ticket
            </div>
            <p className="max-w-md text-xs text-text-muted">
              Ask for an explanation, inspect code, or request a change. Tool calls and file edits will appear here as structured activity.
            </p>
          </div>
        </div>
      ) : (
        <MessagesTimeline
          rows={rows}
          onRetryMessage={(text) => startChatTurn(agentRunId, text)}
          onRetryUnknownMessage={(messageId, text) =>
            retryUnknownChatTurn(agentRunId, messageId, text)}
          onToggleTurn={(turnId) => setExpandedTurnIds((current) => {
            const next = new Set(current);
            if (next.has(turnId)) next.delete(turnId);
            else next.add(turnId);
            return next;
          })}
        />
      )}

      <ChatPendingRequests
        events={session.events}
        onRespondToApproval={(requestId, decision) =>
          respondToChatApproval(agentRunId, requestId, decision)}
        onRespondToUserInput={(requestId, answers) =>
          respondToChatUserInput(agentRunId, requestId, answers)}
      />

      {deliveryReviewRequired ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-t border-lifecycle-attention/30 bg-lifecycle-attention/10 px-3 py-2 text-xs text-lifecycle-attention"
        >
          <span>
            A prior turn may have reached Codex. Review the resumed thread before continuing.
          </span>
          <button
            type="button"
            onClick={() => setReviewedUnknownDelivery(durableUnknownKey)}
            className="shrink-0 rounded border border-lifecycle-attention/60 px-2 py-1 font-semibold hover:bg-lifecycle-attention/10"
          >
            I reviewed the thread
          </button>
        </div>
      ) : null}

      <ChatComposer
        agentRunId={agentRunId}
        status={session.status}
        connection={session.connection}
        retryableError={session.retryable_error}
        processEnded={processEnded}
        deliveryUncertain={deliveryUncertain}
        deliveryReviewRequired={deliveryReviewRequired}
        onSend={(prompt) => startChatTurn(agentRunId, prompt)}
        onInterrupt={() => interruptChat(agentRunId)}
      />
    </div>
  );
}
