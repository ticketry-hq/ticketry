/**
 * Composer-adjacent approval and user-input controls adapted from
 * `pingdotgg/t3code` paths
 * `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`,
 * `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`, and
 * `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx` at revision
 * 45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b (MIT; see
 * `third_party/t3code/LICENSE`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { derivePendingChatRequests } from "./requests";
import type {
  ChatEvent,
  ChatPendingApproval,
  ChatPendingUserInput,
} from "./types";
import type { ChatApprovalDecision } from "./transport";

function ApprovalCard({
  approval,
  onRespond,
}: {
  approval: ChatPendingApproval;
  onRespond: (decision: ChatApprovalDecision) => Promise<void>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = approval.requestKind === "command"
    ? "Command approval requested"
    : approval.requestKind === "file-change"
      ? "File-change approval requested"
      : approval.requestKind === "permission"
        ? "Additional permission requested"
        : "Approval requested";

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  async function respond(decision: ChatApprovalDecision): Promise<void> {
    setResponding(true);
    setError(null);
    try {
      await onRespond(decision);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit approval");
    } finally {
      setResponding(false);
    }
  }

  return (
    <section
      ref={panelRef}
      role="region"
      aria-label="Pending Codex approval"
      aria-live="assertive"
      aria-atomic="true"
      tabIndex={-1}
      className="border-t border-lifecycle-attention/40 bg-lifecycle-attention/10 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lifecycle-attention">
          Pending approval
        </span>
        <span className="text-sm font-medium text-text-primary">{summary}</span>
      </div>
      {approval.detail ? (
        <pre
          aria-label="Approval details"
          className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-pane-border bg-pane-bg p-2 font-mono text-xs text-text-secondary"
        >
          {approval.detail}
        </pre>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-lifecycle-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {approval.availableDecisions.includes("cancel") ? (
          <button type="button" disabled={responding} onClick={() => void respond("cancel")} className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-50">
            Cancel turn
          </button>
        ) : null}
        {approval.availableDecisions.includes("decline") ? (
          <button type="button" disabled={responding} onClick={() => void respond("decline")} className="rounded border border-lifecycle-danger/50 px-2 py-1 text-xs text-lifecycle-danger hover:bg-lifecycle-danger/10 disabled:opacity-50">
            Decline
          </button>
        ) : null}
        {approval.availableDecisions.includes("acceptForSession") ? (
          <button type="button" disabled={responding} onClick={() => void respond("acceptForSession")} className="rounded border border-pane-border px-2 py-1 text-xs text-text-secondary hover:border-focus-accent disabled:opacity-50">
            Always allow this session
          </button>
        ) : null}
        {approval.availableDecisions.includes("accept") ? (
          <button type="button" disabled={responding} onClick={() => void respond("accept")} className="rounded bg-focus-accent px-2 py-1 text-xs font-semibold text-pane-bg disabled:opacity-50">
            {responding ? "Responding…" : "Approve once"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function UserInputCard({
  request,
  onRespond,
}: {
  request: ChatPendingUserInput;
  onRespond: (answers: Record<string, string[]>) => Promise<void>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = request.questions.length === 0 ||
    request.questions.every((question) => (answers[question.id]?.length ?? 0) > 0);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  async function submit(): Promise<void> {
    if (!complete || responding) return;
    setResponding(true);
    setError(null);
    try {
      await onRespond(answers);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit answers");
    } finally {
      setResponding(false);
    }
  }

  return (
    <section
      ref={panelRef}
      role="region"
      aria-label="Codex needs input"
      aria-live="assertive"
      aria-atomic="true"
      tabIndex={-1}
      className="border-t border-focus-accent/40 bg-focus-accent/10 px-4 py-3"
    >
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-focus-accent">
        Codex needs input
      </div>
      <div className="space-y-4">
        {request.questions.map((question) => (
          <fieldset key={question.id} disabled={responding}>
            <legend className="text-sm font-medium text-text-primary">
              <span className="mr-2 text-[10px] uppercase tracking-wide text-text-muted">
                {question.header}
              </span>
              {question.question}
            </legend>
            {question.options.length ? (
              <div className="mt-2 grid gap-1.5">
                {question.options.map((option) => {
                  const selected = answers[question.id]?.[0] === option.label;
                  return (
                    <label key={option.label} className={`flex cursor-pointer gap-2 rounded border px-3 py-2 text-xs ${selected ? "border-focus-accent bg-focus-accent/10" : "border-pane-border bg-pane-bg"}`}>
                      <input
                        type="radio"
                        name={`${request.requestId}:${question.id}`}
                        value={option.label}
                        checked={selected}
                        onChange={() => setAnswers((current) => ({
                          ...current,
                          [question.id]: [option.label],
                        }))}
                      />
                      <span>
                        <span className="block font-medium text-text-primary">{option.label}</span>
                        {option.description !== option.label ? (
                          <span className="text-text-muted">{option.description}</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {question.allowOther ? (
              <input
                aria-label={`${question.header} answer`}
                type={question.isSecret ? "password" : "text"}
                autoComplete={question.isSecret ? "new-password" : "off"}
                value={question.options.some((option) => option.label === answers[question.id]?.[0]) ? "" : answers[question.id]?.[0] ?? ""}
                onChange={(event) => setAnswers((current) => ({
                  ...current,
                  [question.id]: event.target.value.trim() ? [event.target.value] : [],
                }))}
                placeholder="Type another answer…"
                className="mt-2 w-full rounded border border-pane-border bg-pane-bg px-3 py-2 text-xs text-text-primary outline-none focus:border-focus-accent"
              />
            ) : null}
          </fieldset>
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-lifecycle-danger">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={!complete || responding}
          onClick={() => void submit()}
          className="rounded bg-focus-accent px-3 py-1 text-xs font-semibold text-pane-bg disabled:opacity-40"
        >
          {responding ? "Submitting…" : "Submit answers"}
        </button>
      </div>
    </section>
  );
}

export function ChatPendingRequests({
  events,
  onRespondToApproval,
  onRespondToUserInput,
}: {
  events: readonly ChatEvent[];
  onRespondToApproval: (
    requestId: string,
    decision: ChatApprovalDecision,
  ) => Promise<void>;
  onRespondToUserInput: (
    requestId: string,
    answers: Record<string, string[]>,
  ) => Promise<void>;
}) {
  const pending = useMemo(() => derivePendingChatRequests(events), [events]);
  const approval = pending.approvals[0];
  if (approval) {
    return (
      <ApprovalCard
        key={approval.requestId}
        approval={approval}
        onRespond={(decision) => onRespondToApproval(approval.requestId, decision)}
      />
    );
  }
  const userInput = pending.userInputs[0];
  if (userInput) {
    return (
      <UserInputCard
        key={userInput.requestId}
        request={userInput}
        onRespond={(answers) => onRespondToUserInput(userInput.requestId, answers)}
      />
    );
  }
  return null;
}
