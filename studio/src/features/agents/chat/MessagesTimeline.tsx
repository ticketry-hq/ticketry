/**
 * Transcript presentation adapted from `pingdotgg/t3code`
 * `apps/web/src/components/chat/MessagesTimeline.tsx` at revision
 * 45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b (MIT; see
 * `third_party/t3code/LICENSE`). This first Ticketry slice keeps T3's centered
 * reading column, expandable work rows, settled-turn folds, live-edge scroll
 * policy, plans, and file-change affordances without its virtualization graph.
 */

import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChatMarkdown } from "./ChatMarkdown";
import {
  formatDuration,
  resolveTimelineIsAtEnd,
} from "./timeline";
import type {
  ChatActivity,
  ChatDiff,
  ChatPlan,
  ChatTimelineRow,
} from "./types";

function activityGlyph(activity: ChatActivity): string {
  if (activity.status === "inProgress") return "◌";
  if (activity.status === "failed" || activity.status === "declined") return "×";
  if (activity.status === "stopped") return "■";
  return "✓";
}

const ActivityRow = memo(function ActivityRow({ activity }: { activity: ChatActivity }) {
  const hasDetails = Boolean(
    activity.detail || activity.command || activity.changedFiles.length,
  );
  const tone = activity.tone === "error"
    ? "text-lifecycle-danger"
    : activity.status === "inProgress"
      ? "text-lifecycle-active"
      : "text-text-secondary";
  return (
    <details
      className="group border-l border-pane-border pl-3"
      data-testid="chat-activity-row"
      open={activity.tone === "error" ? true : undefined}
    >
      <summary
        className={`flex min-w-0 list-none items-center gap-2 py-1 text-xs ${tone} ${
          hasDetails ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span
          aria-hidden="true"
          className={activity.status === "inProgress" ? "animate-pulse" : ""}
        >
          {activityGlyph(activity)}
        </span>
        <span className="min-w-0 truncate font-mono">{activity.label}</span>
        {hasDetails ? (
          <span className="ml-auto text-[10px] text-text-muted group-open:rotate-90">›</span>
        ) : null}
      </summary>
      {hasDetails ? (
        <div className="mb-2 ml-5 space-y-1 text-xs text-text-muted">
          {activity.changedFiles.length ? (
            <div className="flex flex-wrap gap-1">
              {activity.changedFiles.map((path) => (
                <code key={path} className="rounded bg-pane-title px-1 py-0.5 font-mono">
                  {path}
                </code>
              ))}
            </div>
          ) : null}
          {activity.command ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-pane-bg p-2 font-mono text-xs text-text-secondary">
              {activity.command}
            </pre>
          ) : null}
          {activity.detail ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-pane-bg p-2 font-mono text-xs text-text-secondary">
              {activity.detail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </details>
  );
});

function PlanRow({ plan }: { plan: ChatPlan }) {
  return (
    <section className="rounded-md border border-pane-border bg-pane-panel px-3 py-2">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Plan
      </div>
      {plan.explanation ? (
        <p className="mb-2 text-sm text-text-primary">{plan.explanation}</p>
      ) : null}
      <ol className="space-y-1">
        {plan.steps.map((step, index) => (
          <li key={`${index}:${step.step}`} className="flex gap-2 text-xs text-text-secondary">
            <span aria-hidden="true">
              {step.status === "completed" ? "✓" : step.status === "inProgress" ? "◌" : "○"}
            </span>
            <span className={step.status === "completed" ? "line-through opacity-70" : ""}>
              <span className="sr-only">
                {step.status === "completed"
                  ? "Completed: "
                  : step.status === "inProgress"
                    ? "In progress: "
                    : "Pending: "}
              </span>
              {step.step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DiffPatch({ patch }: { patch: string }) {
  return (
    <pre className="max-h-80 overflow-auto rounded bg-pane-bg p-2 font-mono text-xs">
      {patch.split("\n").map((line, index) => (
        <span
          key={`${index}:${line}`}
          className={`block whitespace-pre ${
            line.startsWith("+") && !line.startsWith("+++")
              ? "bg-lifecycle-success/10 text-lifecycle-success"
              : line.startsWith("-") && !line.startsWith("---")
                ? "bg-lifecycle-danger/10 text-lifecycle-danger"
                : line.startsWith("@@")
                  ? "text-focus-accent"
                  : "text-text-secondary"
          }`}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function DiffRow({ diff }: { diff: ChatDiff }) {
  return (
    <details className="rounded-md border border-pane-border bg-pane-panel px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-text-secondary">
        {diff.title}
        {diff.files.length ? ` · ${diff.files.length} file${diff.files.length === 1 ? "" : "s"}` : ""}
      </summary>
      {diff.files.length ? (
        <div className="my-2 flex flex-wrap gap-1">
          {diff.files.map((path) => (
            <code key={path} className="rounded bg-pane-title px-1 py-0.5 font-mono text-xs">
              {path}
            </code>
          ))}
        </div>
      ) : null}
      {diff.patch ? <DiffPatch patch={diff.patch} /> : (
        <p className="mt-2 text-xs text-text-muted">A structured file change was recorded.</p>
      )}
    </details>
  );
}

function MessageRow({
  row,
  onRetry,
  onRetryUnknown,
}: {
  row: Extract<ChatTimelineRow, { kind: "message" }>;
  onRetry?: (text: string) => Promise<void>;
  onRetryUnknown?: (messageId: string, text: string) => Promise<void>;
}) {
  const { message } = row;
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  if (message.role === "user") {
    // A failed delivery creates a new message. An unknown delivery can only be
    // retried through the original command id, which the backend deduplicates.
    const retryable = message.delivery === "failed" &&
      message.deliveryRetryable !== false;
    const retryableUnknown = message.delivery === "unknown" && onRetryUnknown;
    return (
      <article
        data-testid="chat-message-user"
        className="ml-auto max-w-[88%] rounded-xl rounded-br-sm border border-pane-border bg-pane-title px-3 py-2"
      >
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-text-secondary">
          <span>You</span>
          {message.delivery === "pending" ? (
            <span className="font-normal text-text-muted">Sending…</span>
          ) : message.delivery === "unknown" ? (
            <span className="font-normal text-lifecycle-attention">Delivery unconfirmed</span>
          ) : message.deliveryUnknownFinal ? (
            <span className="font-normal text-lifecycle-attention">Delivery outcome unknown</span>
          ) : message.delivery === "failed" ? (
            <span className="font-normal text-lifecycle-danger">Not sent</span>
          ) : null}
        </div>
        <div className="whitespace-pre-wrap text-sm text-text-primary">{message.text}</div>
        {message.deliveryError ? (
          <p className="mt-1 text-xs text-lifecycle-danger">{message.deliveryError}</p>
        ) : null}
        {message.delivery === "unknown" ? (
          <p className="mt-1 text-xs text-text-muted">
            Retry safely with the original delivery id, or reconnect to wait for replay.
          </p>
        ) : null}
        {message.deliveryUnknownFinal ? (
          <p className="mt-1 text-xs text-text-muted">
            Ticketry cannot safely redeliver this turn after restart. Review the resumed thread
            before sending another message.
          </p>
        ) : null}
        {retryableUnknown ? (
          <div className="mt-2">
            <button
              type="button"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                setRetryError(null);
                void onRetryUnknown(message.id, message.text)
                  .catch((error: unknown) => {
                    setRetryError(
                      error instanceof Error ? error.message : "Delivery remains unconfirmed",
                    );
                  })
                  .finally(() => setRetrying(false));
              }}
              className="rounded border border-lifecycle-attention/60 px-2 py-1 text-xs text-lifecycle-attention hover:bg-lifecycle-attention/10 disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry delivery"}
            </button>
            {retryError ? <p role="alert" className="mt-1 text-xs text-lifecycle-danger">{retryError}</p> : null}
          </div>
        ) : null}
        {retryable && onRetry ? (
          <div className="mt-2">
            <button
              type="button"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                setRetryError(null);
                void onRetry(message.text)
                  .catch((error: unknown) => {
                    setRetryError(
                      error instanceof Error ? error.message : "Retry failed",
                    );
                  })
                  .finally(() => setRetrying(false));
              }}
              className="rounded border border-pane-border px-2 py-1 text-xs text-text-secondary hover:border-focus-accent disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry message"}
            </button>
            {retryError ? <p role="alert" className="mt-1 text-xs text-lifecycle-danger">{retryError}</p> : null}
          </div>
        ) : null}
      </article>
    );
  }
  const elapsed = Date.parse(message.updatedAt) - Date.parse(row.durationStart);
  return (
    <article data-testid="chat-message-assistant" className="min-w-0 py-1">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-text-secondary">
        <span>Codex</span>
        {message.streaming ? (
          <span className="font-normal text-lifecycle-active">Responding</span>
        ) : null}
      </div>
      <ChatMarkdown text={message.text} streaming={message.streaming} />
      {row.showAssistantMeta ? (
        <div className="mt-2 text-[11px] text-text-muted">
          {Number.isFinite(elapsed) && elapsed >= 0 ? formatDuration(elapsed) : "Completed"}
        </div>
      ) : null}
    </article>
  );
}

export const MessagesTimeline = memo(function MessagesTimeline({
  rows,
  onToggleTurn,
  onRetryMessage,
  onRetryUnknownMessage,
}: {
  rows: readonly ChatTimelineRow[];
  onToggleTurn: (turnId: string) => void;
  onRetryMessage?: (text: string) => Promise<void>;
  onRetryUnknownMessage?: (messageId: string, text: string) => Promise<void>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !followingRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [rows]);

  function jumpToLatest(): void {
    const viewport = viewportRef.current;
    if (!viewport) return;
    followingRef.current = true;
    setShowJump(false);
    viewport.scrollTop = viewport.scrollHeight;
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        role="log"
        aria-label="Codex conversation"
        aria-live="polite"
        data-testid="chat-transcript"
        onScroll={() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          const isAtEnd = resolveTimelineIsAtEnd({
            scrollHeight: viewport.scrollHeight,
            scrollTop: viewport.scrollTop,
            clientHeight: viewport.clientHeight,
          });
          followingRef.current = isAtEnd;
          setShowJump(!isAtEnd);
        }}
        className="absolute inset-0 overflow-y-auto px-4 py-5"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-4">
          {rows.map((row) => {
            if (row.kind === "message") {
              return (
                <MessageRow
                  key={row.id}
                  row={row}
                  onRetry={onRetryMessage}
                  onRetryUnknown={onRetryUnknownMessage}
                />
              );
            }
            if (row.kind === "activity") {
              return <ActivityRow key={row.id} activity={row.activity} />;
            }
            if (row.kind === "turn-fold") {
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-expanded={row.expanded}
                  onClick={() => onToggleTurn(row.turnId)}
                  className="flex items-center gap-2 self-start border-l border-pane-border py-1 pl-3 text-xs text-text-muted hover:text-text-primary"
                >
                  <span aria-hidden="true">{row.expanded ? "⌄" : "›"}</span>
                  {row.label}
                </button>
              );
            }
            if (row.kind === "plan") return <PlanRow key={row.id} plan={row.plan} />;
            if (row.kind === "diff") return <DiffRow key={row.id} diff={row.diff} />;
            return (
              <div
                key={row.id}
                className="flex items-center gap-2 text-xs text-lifecycle-active"
              >
                <span className="animate-pulse" aria-hidden="true">●</span>
                <span>Codex is working…</span>
              </div>
            );
          })}
        </div>
      </div>
      {showJump ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-pane-border bg-pane-panel px-3 py-1 text-xs text-text-secondary shadow-lg hover:text-text-primary"
        >
          Jump to latest ↓
        </button>
      ) : null}
    </div>
  );
});
