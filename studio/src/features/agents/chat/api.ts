import { agentApiUrl, runtimeConfiguration } from "../../../runtime";
import type {
  ChatEvent,
  ChatSessionStatus,
  ChatSessionSummary,
  ChatSnapshot,
  CreateChatRunRequest,
} from "./types";

export class ChatApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(
  value: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  if (!value) return null;
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key];
  }
  return null;
}

function firstNumber(
  value: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  if (!value) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
      return candidate;
    }
  }
  return null;
}

const CHAT_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "starting",
  "ready",
  "running",
  "interrupted",
  "stopped",
  "error",
]);

function sessionStatus(value: unknown): ChatSessionStatus {
  return typeof value === "string" && CHAT_SESSION_STATUSES.has(value)
    ? value as ChatSessionStatus
    : "starting";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = runtimeConfiguration().values.workTrackerApiKey;
  const response = await fetch(agentApiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const data = record(body);
    const message = firstString(data, "message", "detail") ?? `HTTP ${response.status}`;
    throw new ChatApiError(response.status, message, body);
  }
  return body as T;
}

export function normalizeChatEvent(value: unknown): ChatEvent | null {
  const row = record(value);
  const sequence = firstNumber(row, "sequence");
  const eventType = firstString(row, "event_type", "eventType", "type");
  if (sequence === null || sequence < 0 || !eventType) return null;
  return {
    sequence,
    event_type: eventType,
    payload: record(row?.payload) ?? {},
    created_at: firstString(row, "created_at", "createdAt") ?? new Date(0).toISOString(),
  };
}

/**
 * The parser accepts snake_case REST rows and the equivalent camelCase fields
 * so one frontend build can cross the staged backend rollout safely.
 */
export function normalizeChatSummary(
  value: unknown,
  fallbackTaskId: string | null = null,
): ChatSessionSummary | null {
  const row = record(value);
  const nestedRun = record(row?.run);
  const nestedSession = record(row?.session);
  const run = nestedRun ?? row;
  const session = nestedSession ?? row;
  const agentRunId = firstString(
    run,
    "agent_run_id",
    "agentRunId",
    "id",
  ) ?? firstString(row, "agent_run_id", "agentRunId");
  if (!agentRunId) return null;

  const lastSequence = firstNumber(
    row,
    "last_sequence",
    "lastSequence",
    "cursor",
  ) ?? Math.max(0, (firstNumber(session, "next_sequence", "nextSequence") ?? 1) - 1);

  return {
    agent_run_id: agentRunId,
    project_id:
      firstString(run, "project_id", "projectId") ??
      firstString(row, "project_id", "projectId"),
    task_id:
      firstString(run, "task_id", "taskId") ??
      firstString(row, "task_id", "taskId") ??
      fallbackTaskId,
    module_id:
      firstString(run, "module_id", "moduleId") ??
      firstString(row, "module_id", "moduleId") ??
      "",
    agent: "codex",
    run_status:
      firstString(row, "run_status", "runStatus") ??
      (nestedRun
        ? firstString(run, "run_status", "runStatus", "status")
        : null),
    status: sessionStatus(session?.status ?? run?.status),
    active_turn_id:
      firstString(session, "active_turn_id", "activeTurnId") ??
      firstString(row, "active_turn_id", "activeTurnId"),
    started_at:
      firstString(run, "started_at", "startedAt") ??
      firstString(row, "started_at", "startedAt"),
    ended_at:
      firstString(run, "ended_at", "endedAt") ??
      firstString(row, "ended_at", "endedAt"),
    updated_at:
      firstString(session, "updated_at", "updatedAt") ??
      firstString(run, "updated_at", "updatedAt") ??
      firstString(row, "updated_at", "updatedAt"),
    last_error:
      firstString(session, "last_error", "lastError") ??
      firstString(row, "last_error", "lastError"),
    last_sequence: Math.max(0, lastSequence),
  };
}

export function normalizeChatSnapshot(
  value: unknown,
  fallback?: ChatSessionSummary,
): ChatSnapshot | null {
  const envelope = record(value);
  if (!envelope) return null;
  const normalizedEvents = (Array.isArray(envelope.events) ? envelope.events : [])
    .flatMap((event) => {
      const normalized = normalizeChatEvent(event);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => left.sequence - right.sequence);
  const cursor = firstNumber(envelope, "cursor") ??
    normalizedEvents.at(-1)?.sequence ??
    fallback?.last_sequence ??
    0;
  const summary = normalizeChatSummary(envelope, fallback?.task_id ?? null) ?? fallback;
  if (!summary) return null;
  const session = record(envelope.session);
  return {
    run: { ...summary, last_sequence: Math.max(summary.last_sequence, cursor) },
    session: {
      status: sessionStatus(session?.status ?? summary.status),
      active_turn_id:
        firstString(session, "active_turn_id", "activeTurnId") ??
        summary.active_turn_id,
      last_error:
        firstString(session, "last_error", "lastError") ??
        summary.last_error,
      provider_thread_id: firstString(
        session,
        "provider_thread_id",
        "providerThreadId",
      ),
      next_sequence: firstNumber(session, "next_sequence", "nextSequence") ?? undefined,
      updated_at:
        firstString(session, "updated_at", "updatedAt") ?? summary.updated_at,
    },
    events: normalizedEvents,
    cursor: Math.max(0, cursor),
  };
}

export async function listChatSessions(
  taskId: string,
  signal?: AbortSignal,
): Promise<ChatSessionSummary[]> {
  const value = await request<unknown>(
    `/api/chats?task_id=${encodeURIComponent(taskId)}`,
    { signal },
  );
  const envelope = record(value);
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(envelope?.chats)
      ? envelope.chats
      : Array.isArray(envelope?.results)
        ? envelope.results
        : [];
  return rows.flatMap((row) => {
    const normalized = normalizeChatSummary(row, taskId);
    return normalized ? [normalized] : [];
  });
}

export async function createChatRun(
  body: CreateChatRunRequest,
): Promise<{ agent_run_id: string }> {
  return request<{ agent_run_id: string }>("/api/chats", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getChatSnapshot(
  agentRunId: string,
  after = 0,
  signal?: AbortSignal,
): Promise<ChatSnapshot> {
  const value = await request<unknown>(
    `/api/chats/${encodeURIComponent(agentRunId)}?after=${Math.max(0, after)}`,
    { signal },
  );
  const snapshot = normalizeChatSnapshot(value);
  if (!snapshot) throw new ChatApiError(502, "Chat snapshot was malformed", value);
  return snapshot;
}

export const sendChatTurn = (
  agentRunId: string,
  prompt: string,
  commandId: string,
) =>
  request<{ turn_id: string }>(
    `/api/chats/${encodeURIComponent(agentRunId)}/turns`,
    {
      method: "POST",
      body: JSON.stringify({ prompt, command_id: commandId }),
    },
  );

export const interruptChatTurn = (agentRunId: string) =>
  request<{ interrupted: boolean }>(
    `/api/chats/${encodeURIComponent(agentRunId)}/interrupt`,
    { method: "POST" },
  );

export const stopChatRun = (agentRunId: string) =>
  request<{ agent_run_id: string; stopped: boolean }>(
    `/api/chats/${encodeURIComponent(agentRunId)}`,
    { method: "DELETE" },
  );

export const resumeChatRun = (agentRunId: string) =>
  request<{ agent_run_id: string; resumed: boolean }>(
    `/api/chats/${encodeURIComponent(agentRunId)}/resume`,
    { method: "POST" },
  );

export const respondToChatApproval = (
  agentRunId: string,
  requestId: string,
  decision: "accept" | "acceptForSession" | "decline" | "cancel",
) => request<{ accepted: boolean }>(
  `/api/chats/${encodeURIComponent(agentRunId)}/approvals`,
  {
    method: "POST",
    body: JSON.stringify({ request_id: requestId, decision }),
  },
);

export const respondToChatUserInput = (
  agentRunId: string,
  requestId: string,
  answers: Record<string, string[]>,
) => request<{ accepted: boolean }>(
  `/api/chats/${encodeURIComponent(agentRunId)}/user-input`,
  {
    method: "POST",
    body: JSON.stringify({ request_id: requestId, answers }),
  },
);
