/**
 * Pending-request projection adapted from `pingdotgg/t3code` path
 * `apps/web/src/session-logic.ts` at revision
 * 45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b (MIT; see
 * `third_party/t3code/LICENSE`). Ticketry projects its durable request and
 * response events directly instead of T3's orchestration activity union.
 */

import type {
  ChatEvent,
  ChatPendingApproval,
  ChatPendingUserInput,
  ChatUserInputQuestion,
} from "./types";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requestId(payload: RecordValue): string | null {
  return string(payload.requestId) ?? string(payload.request_id);
}

function approvalKind(method: string | null): ChatPendingApproval["requestKind"] {
  const normalized = method?.toLowerCase() ?? "";
  if (normalized.includes("command")) return "command";
  if (normalized.includes("filechange") || normalized.includes("file_change")) {
    return "file-change";
  }
  if (normalized.includes("permission")) return "permission";
  return "other";
}

function approvalDetail(params: RecordValue): string | null {
  const command = string(params.command);
  const reason = string(params.reason);
  const root = string(params.grantRoot) ?? string(params.cwd);
  const parts = [command, reason, root].filter((value): value is string => Boolean(value));
  if (parts.length) return parts.join("\n");
  const safeEntries = Object.entries(params).filter(
    ([key]) => !["threadId", "turnId", "startedAtMs"].includes(key),
  );
  return safeEntries.length ? JSON.stringify(Object.fromEntries(safeEntries), null, 2) : null;
}

const APPROVAL_DECISIONS = new Set([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
] as const);

function availableApprovalDecisions(
  params: RecordValue,
): ChatPendingApproval["availableDecisions"] {
  const advertised = Array.isArray(params.availableDecisions)
    ? params.availableDecisions
    : Array.isArray(params.available_decisions)
      ? params.available_decisions
      : null;
  if (!advertised?.length) return [...APPROVAL_DECISIONS];
  return advertised.filter(
    (decision): decision is ChatPendingApproval["availableDecisions"][number] =>
      typeof decision === "string" &&
      APPROVAL_DECISIONS.has(
        decision as ChatPendingApproval["availableDecisions"][number],
      ),
  );
}

function normalizeQuestion(value: unknown): ChatUserInputQuestion | null {
  const row = record(value);
  if (!row) return null;
  const id = string(row.id);
  const question = string(row.question);
  if (!id || !question) return null;
  const options = (Array.isArray(row.options) ? row.options : []).flatMap((value) => {
    const option = record(value);
    const label = string(option?.label);
    if (!label) return [];
    return [{
      label,
      description: string(option?.description) ?? label,
    }];
  });
  return {
    id,
    header: string(row.header) ?? "Codex needs input",
    question,
    options,
    allowOther: row.isOther === true || options.length === 0,
    isSecret: row.isSecret === true,
  };
}

export function derivePendingChatRequests(events: readonly ChatEvent[]): {
  approvals: ChatPendingApproval[];
  userInputs: ChatPendingUserInput[];
} {
  const approvals = new Map<string, {
    request: ChatPendingApproval;
    turnId: string | null;
  }>();
  const userInputs = new Map<string, {
    request: ChatPendingUserInput;
    turnId: string | null;
  }>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const id = requestId(event.payload);
    if (event.event_type === "thread.approval-response-requested" && id) {
      const params = record(event.payload.payload) ?? {};
      const method = string(event.payload.requestKind);
      approvals.set(id, {
        request: {
          requestId: id,
          requestKind: approvalKind(method),
          detail: approvalDetail(params),
          availableDecisions: availableApprovalDecisions(params),
          createdAt: event.created_at,
        },
        turnId: string(params.turnId) ?? string(params.turn_id),
      });
      continue;
    }
    if (event.event_type === "thread.user-input-response-requested" && id) {
      const params = record(event.payload.payload) ?? {};
      const questions = (Array.isArray(params.questions) ? params.questions : [])
        .flatMap((value) => {
          const question = normalizeQuestion(value);
          return question ? [question] : [];
        });
      userInputs.set(id, {
        request: { requestId: id, questions, createdAt: event.created_at },
        turnId: string(params.turnId) ?? string(params.turn_id),
      });
      continue;
    }
    if (
      id &&
      (event.event_type === "thread.approval-responded" ||
        event.event_type === "thread.request-resolved")
    ) {
      approvals.delete(id);
    }
    if (
      id &&
      (event.event_type === "thread.user-input-responded" ||
        event.event_type === "thread.request-resolved")
    ) {
      userInputs.delete(id);
    }
    if (
      event.event_type === "thread.session-interrupted" ||
      event.event_type === "thread.session-exited" ||
      event.event_type === "thread.session-stopped"
    ) {
      approvals.clear();
      userInputs.clear();
      continue;
    }
    if (
      event.event_type === "thread.turn-completed" ||
      event.event_type === "thread.turn-interrupted"
    ) {
      const turn = record(event.payload.turn);
      const turnId = string(event.payload.turnId) ??
        string(event.payload.turn_id) ??
        string(turn?.id);
      if (!turnId) continue;
      for (const [requestId, pending] of approvals) {
        if (pending.turnId === turnId) approvals.delete(requestId);
      }
      for (const [requestId, pending] of userInputs) {
        if (pending.turnId === turnId) userInputs.delete(requestId);
      }
    }
  }
  return {
    approvals: [...approvals.values()].map(({ request }) => request),
    userInputs: [...userInputs.values()].map(({ request }) => request),
  };
}
