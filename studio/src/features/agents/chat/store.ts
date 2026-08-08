import { create } from "zustand";
import type {
  ChatConnectionState,
  ChatEvent,
  ChatSessionStatus,
  ChatSessionSummary,
  ChatSnapshot,
  PendingChatMessage,
} from "./types";
import {
  chatMessageFailure,
  chatTurnError,
  chatTurnOutcome,
} from "./eventSemantics";

const DISMISSED_CHAT_RUNS_KEY = "ticketry.dismissed-chat-runs:v1";
const MAX_DISMISSED_TASKS = 100;
const MAX_DISMISSED_RUNS_PER_TASK = 50;

type DismissedChatRuns = Record<string, string[]>;

function readDismissedRuns(): DismissedChatRuns {
  try {
    const raw = localStorage.getItem(DISMISSED_CHAT_RUNS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([taskId, value]) =>
        Array.isArray(value)
          ? [[taskId, value.filter((id): id is string => typeof id === "string")]]
          : [],
      ),
    );
  } catch {
    return {};
  }
}

function writeDismissedRuns(value: DismissedChatRuns): void {
  try {
    localStorage.setItem(DISMISSED_CHAT_RUNS_KEY, JSON.stringify(value));
  } catch {
    /* Dismissal persistence is best-effort when storage is unavailable. */
  }
}

function dismissRun(taskId: string, agentRunId: string): void {
  const current = readDismissedRuns();
  const ids = (current[taskId] ?? []).filter((id) => id !== agentRunId);
  delete current[taskId];
  current[taskId] = [...ids, agentRunId].slice(-MAX_DISMISSED_RUNS_PER_TASK);
  for (const stale of Object.keys(current).slice(0, -MAX_DISMISSED_TASKS)) {
    delete current[stale];
  }
  writeDismissedRuns(current);
}

function restoreRun(taskId: string, agentRunId: string): void {
  const current = readDismissedRuns();
  const next = (current[taskId] ?? []).filter((id) => id !== agentRunId);
  if (next.length) current[taskId] = next;
  else delete current[taskId];
  writeDismissedRuns(current);
}

export function dismissedChatRunsFor(taskId: string): ReadonlySet<string> {
  return new Set(readDismissedRuns()[taskId] ?? []);
}

export interface ChatSessionState extends ChatSessionSummary {
  events: ChatEvent[];
  cursor: number;
  connection: ChatConnectionState;
  transport_error: string | null;
  pending_user_messages: PendingChatMessage[];
  /** The provider process is alive; retry with a new turn rather than Resume. */
  retryable_error: boolean;
}

interface ChatStoreState {
  sessions: Record<string, ChatSessionState>;
  activeByTask: Record<string, string>;
  hydrateTask: (taskId: string, summaries: readonly ChatSessionSummary[]) => void;
  openSession: (summary: ChatSessionSummary, select?: boolean) => void;
  installSnapshot: (agentRunId: string, snapshot: ChatSnapshot) => void;
  ingestEvent: (agentRunId: string, event: ChatEvent) => void;
  setConnection: (
    agentRunId: string,
    connection: ChatConnectionState,
    error?: string | null,
  ) => void;
  setStatus: (
    agentRunId: string,
    status: ChatSessionStatus,
    activeTurnId?: string | null,
  ) => void;
  markResuming: (agentRunId: string) => void;
  enqueueUserMessage: (agentRunId: string, message: PendingChatMessage) => void;
  rejectUserMessage: (agentRunId: string, messageId: string) => void;
  markUserMessageUnknown: (agentRunId: string, messageId: string) => void;
  selectSession: (taskId: string, agentRunId: string) => void;
  closeTab: (taskId: string, agentRunId: string) => void;
  reset: () => void;
}

function emptySession(summary: ChatSessionSummary): ChatSessionState {
  return {
    ...summary,
    events: [],
    // The list row advertises the server watermark, but this client has not
    // loaded those events yet. Resume from zero until a snapshot installs the
    // corresponding transcript; otherwise the first socket would skip history.
    cursor: 0,
    connection: "disconnected",
    transport_error: null,
    pending_user_messages: [],
    retryable_error: false,
  };
}

function mergeSummary(
  current: ChatSessionState | undefined,
  summary: ChatSessionSummary,
): ChatSessionState {
  if (!current) return emptySession(summary);
  return {
    ...current,
    ...summary,
    cursor: current.cursor,
  };
}

function processHasEnded(summary: ChatSessionSummary): boolean {
  if (summary.ended_at) return true;
  return summary.run_status !== null &&
    summary.run_status !== "running" &&
    summary.run_status !== "starting" &&
    summary.run_status !== "interrupted";
}

function payloadRecord(event: ChatEvent): Record<string, unknown> {
  return event.payload;
}

function payloadTurnId(event: ChatEvent): string | null {
  const payload = payloadRecord(event);
  if (typeof payload.turnId === "string") return payload.turnId;
  if (typeof payload.turn_id === "string") return payload.turn_id;
  const turn = payload.turn;
  return turn && typeof turn === "object" && !Array.isArray(turn) &&
    typeof (turn as Record<string, unknown>).id === "string"
    ? (turn as Record<string, unknown>).id as string
    : null;
}

function sessionAfterEvent(
  session: ChatSessionState,
  event: ChatEvent,
): ChatSessionState {
  let status = session.status;
  let activeTurnId = session.active_turn_id;
  let lastError = session.last_error;
  let retryableError = session.retryable_error;
  let runStatus = session.run_status;
  let endedAt = session.ended_at;
  if (event.event_type === "thread.turn-started") {
    status = "running";
    activeTurnId = payloadTurnId(event);
    lastError = null;
    retryableError = false;
  } else if (event.event_type === "thread.turn-completed") {
    const outcome = chatTurnOutcome(event);
    status = outcome === "interrupted"
      ? "interrupted"
      : outcome === "failed"
        ? "error"
        : "ready";
    activeTurnId = null;
    lastError = outcome === "failed" ? chatTurnError(event) : null;
    retryableError = outcome === "failed";
  } else if (event.event_type === "thread.turn-interrupted") {
    status = "interrupted";
    activeTurnId = null;
    retryableError = false;
  } else if (event.event_type === "thread.message-failed") {
    const failure = chatMessageFailure(event);
    status = "error";
    activeTurnId = null;
    lastError = failure?.error ?? "Message could not be delivered";
    retryableError = failure?.retryable ?? false;
  } else if (event.event_type === "thread.session-interrupted") {
    status = "interrupted";
    activeTurnId = null;
    const message = event.payload.message;
    lastError = typeof message === "string" ? message : lastError;
    retryableError = false;
    runStatus = "interrupted";
    endedAt = null;
  } else if (
    event.event_type === "thread.session-resumed" ||
    event.event_type === "thread.session-set"
  ) {
    const eventStatus = event.payload.status;
    status = eventStatus === "running" ? "running" : "ready";
    activeTurnId = null;
    lastError = null;
    retryableError = false;
    runStatus = "running";
    endedAt = null;
  } else if (event.event_type === "thread.session-exited") {
    const eventStatus = event.payload.status;
    status = eventStatus === "error" ? "error" : "stopped";
    activeTurnId = null;
    lastError = typeof event.payload.error === "string" ? event.payload.error : lastError;
    retryableError = false;
    runStatus = "exited";
    endedAt = event.created_at;
  } else if (event.event_type === "thread.session-stopped") {
    status = "stopped";
    activeTurnId = null;
    retryableError = false;
    runStatus = "terminated";
    endedAt = event.created_at;
  } else if (event.event_type === "thread.error") {
    if (event.payload.willRetry === true) {
      return {
        ...session,
        updated_at: event.created_at,
        last_sequence: Math.max(session.last_sequence, event.sequence),
        cursor: Math.max(session.cursor, event.sequence),
      };
    }
    // A failed optional initial prompt does not kill the provider process.
    // Leave the durable error visible, but allow the user to retry from the
    // composer instead of trapping a live session in a disabled state.
    status = event.payload.phase === "initial_turn" ? "ready" : "error";
    activeTurnId = null;
    const error = event.payload.error;
    const message = event.payload.message;
    lastError = typeof message === "string"
      ? message
      : typeof error === "string"
      ? error
      : error && typeof error === "object" &&
          typeof (error as Record<string, unknown>).message === "string"
        ? (error as Record<string, unknown>).message as string
        : "Codex reported an error";
    retryableError = event.payload.phase === "initial_turn";
  }

  const pendingUserMessages = event.event_type === "thread.message-sent"
    ? (() => {
        const ids = [
          event.payload.command_id,
          event.payload.commandId,
          event.payload.id,
          event.payload.message_id,
          event.payload.messageId,
        ].filter((value): value is string => typeof value === "string");
        const text = typeof event.payload.text === "string" ? event.payload.text : null;
        const byId = session.pending_user_messages.findIndex((message) =>
          ids.includes(message.id)
        );
        const index = byId >= 0 || text === null
          ? byId
          : session.pending_user_messages.findIndex((message) => message.text === text);
        return index < 0
          ? session.pending_user_messages
          : session.pending_user_messages.filter((_, candidate) => candidate !== index);
      })()
    : session.pending_user_messages;

  return {
    ...session,
    status,
    active_turn_id: activeTurnId,
    last_error: lastError,
    retryable_error: retryableError,
    run_status: runStatus,
    ended_at: endedAt,
    updated_at: event.created_at,
    last_sequence: Math.max(session.last_sequence, event.sequence),
    cursor: Math.max(session.cursor, event.sequence),
    pending_user_messages: pendingUserMessages,
  };
}

function mergeEvents(
  current: readonly ChatEvent[],
  incoming: readonly ChatEvent[],
): ChatEvent[] {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export const useChatStore = create<ChatStoreState>((set) => ({
  sessions: {},
  activeByTask: {},

  hydrateTask(taskId, summaries) {
    const dismissed = dismissedChatRunsFor(taskId);
    set((state) => {
      const sessions = { ...state.sessions };
      for (const summary of summaries) {
        if (dismissed.has(summary.agent_run_id)) continue;
        const historical = summary.status === "stopped" ||
          (summary.status === "error" && processHasEnded(summary));
        // Ended history remains in the durable query for explicit reopen, but
        // does not auto-open a tab and cursor-0 socket merely by visiting.
        if (historical && !sessions[summary.agent_run_id]) continue;
        sessions[summary.agent_run_id] = mergeSummary(
          sessions[summary.agent_run_id],
          summary,
        );
      }
      const visible = summaries
        .filter((summary) =>
          !dismissed.has(summary.agent_run_id) && Boolean(sessions[summary.agent_run_id])
        )
        .sort((left, right) =>
          (left.started_at ?? "").localeCompare(right.started_at ?? "") ||
          left.agent_run_id.localeCompare(right.agent_run_id),
        );
      const selected = state.activeByTask[taskId];
      const withoutStaleSelection = { ...state.activeByTask };
      if (selected && !sessions[selected]) delete withoutStaleSelection[taskId];
      return {
        sessions,
        activeByTask:
          selected && sessions[selected]
            ? state.activeByTask
            : visible.length > 0
              ? { ...withoutStaleSelection, [taskId]: visible[visible.length - 1].agent_run_id }
              : withoutStaleSelection,
      };
    });
  },

  openSession(summary, select = true) {
    if (summary.task_id) restoreRun(summary.task_id, summary.agent_run_id);
    set((state) => ({
      sessions: {
        ...state.sessions,
        [summary.agent_run_id]: mergeSummary(
          state.sessions[summary.agent_run_id],
          summary,
        ),
      },
      activeByTask:
        select && summary.task_id
          ? { ...state.activeByTask, [summary.task_id]: summary.agent_run_id }
          : state.activeByTask,
    }));
  },

  installSnapshot(agentRunId, snapshot) {
    set((state) => {
      let session = mergeSummary(state.sessions[agentRunId], snapshot.run);
      const events = mergeEvents(session.events, snapshot.events);
      for (const event of snapshot.events) session = sessionAfterEvent(session, event);
      const initialTurnError = [...events].reverse().find(
        (event) => event.event_type === "thread.error",
      );
      const recoverableInitialTurnError =
        initialTurnError?.payload.phase === "initial_turn" &&
        !events.some((event) =>
          event.sequence > initialTurnError.sequence &&
          (event.event_type === "thread.session-exited" ||
            event.event_type === "thread.session-interrupted" ||
            (event.event_type === "thread.error" &&
              event.payload.phase !== "initial_turn"))
        );
      session = {
        ...session,
        status:
          snapshot.session.status === "error" && recoverableInitialTurnError
            ? "ready"
            : snapshot.session.status,
        active_turn_id: snapshot.session.active_turn_id,
        last_error: snapshot.session.last_error,
        retryable_error:
          recoverableInitialTurnError || session.retryable_error,
        updated_at: snapshot.session.updated_at ?? session.updated_at,
        events,
        cursor: Math.max(session.cursor, snapshot.cursor),
        last_sequence: Math.max(session.last_sequence, snapshot.cursor),
      };
      return { sessions: { ...state.sessions, [agentRunId]: session } };
    });
  },

  ingestEvent(agentRunId, event) {
    set((state) => {
      const current = state.sessions[agentRunId];
      if (!current) return state;
      const existing = current.events.find((candidate) =>
        candidate.sequence === event.sequence
      );
      if (existing) return state;
      const updated = sessionAfterEvent(current, event);
      return {
        sessions: {
          ...state.sessions,
          [agentRunId]: {
            ...updated,
            events: mergeEvents(current.events, [event]),
          },
        },
      };
    });
  },

  setConnection(agentRunId, connection, error = null) {
    set((state) => {
      const current = state.sessions[agentRunId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [agentRunId]: {
            ...current,
            connection,
            transport_error: error,
          },
        },
      };
    });
  },

  setStatus(agentRunId, status, activeTurnId) {
    set((state) => {
      const current = state.sessions[agentRunId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [agentRunId]: {
            ...current,
            status,
            retryable_error: status === "error" ? current.retryable_error : false,
            run_status: status === "stopped" ? "terminated" : current.run_status,
            ended_at: status === "stopped"
              ? current.ended_at ?? new Date().toISOString()
              : current.ended_at,
            active_turn_id:
              activeTurnId === undefined ? current.active_turn_id : activeTurnId,
          },
        },
      };
    });
  },

  markResuming(agentRunId) {
    set((state) => {
      const current = state.sessions[agentRunId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [agentRunId]: {
            ...current,
            status: "starting",
            active_turn_id: null,
            last_error: null,
            transport_error: null,
            retryable_error: false,
            run_status: "running",
            ended_at: null,
          },
        },
      };
    });
  },

  enqueueUserMessage(agentRunId, message) {
    set((state) => {
      const current = state.sessions[agentRunId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [agentRunId]: {
            ...current,
            status: "running",
            last_error: null,
            retryable_error: false,
            pending_user_messages: [...current.pending_user_messages, message],
          },
        },
      };
    });
  },

  rejectUserMessage(agentRunId, messageId) {
    set((state) => {
      const current = state.sessions[agentRunId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [agentRunId]: {
            ...current,
            status: current.retryable_error
              ? current.status
              : current.active_turn_id ? "running" : "ready",
            pending_user_messages: current.pending_user_messages.filter(
              (message) => message.id !== messageId,
            ),
          },
        },
      };
    });
  },

  markUserMessageUnknown(agentRunId, messageId) {
    set((state) => {
      const current = state.sessions[agentRunId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [agentRunId]: {
            ...current,
            status: current.active_turn_id ? "running" : "ready",
            pending_user_messages: current.pending_user_messages.map((message) =>
              message.id === messageId
                ? { ...message, delivery: "unknown" as const }
                : message
            ),
          },
        },
      };
    });
  },

  selectSession(taskId, agentRunId) {
    restoreRun(taskId, agentRunId);
    set((state) => ({
      activeByTask: { ...state.activeByTask, [taskId]: agentRunId },
    }));
  },

  closeTab(taskId, agentRunId) {
    dismissRun(taskId, agentRunId);
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[agentRunId];
      const activeByTask = { ...state.activeByTask };
      if (activeByTask[taskId] === agentRunId) delete activeByTask[taskId];
      return { sessions, activeByTask };
    });
  },

  reset() {
    set({ sessions: {}, activeByTask: {} });
  },
}));
