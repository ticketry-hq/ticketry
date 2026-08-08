/**
 * Structured Chat contract adapted from `pingdotgg/t3code`'s normalized
 * orchestration model (`packages/contracts/src/orchestration.ts`) at revision
 * 45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b.
 *
 * T3 Code is Copyright (c) 2026 T3 Tools Inc. and licensed under MIT; see
 * `third_party/t3code/LICENSE`. Ticketry intentionally keeps this contract
 * small and dependency-free while preserving T3's message/activity/session
 * vocabulary.
 */

export type ChatSessionStatus =
  | "starting"
  | "ready"
  | "running"
  | "interrupted"
  | "stopped"
  | "error";

export type ChatConnectionState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "error";

/** Compact row returned by `GET /api/chats?task_id=...`. */
export interface ChatSessionSummary {
  agent_run_id: string;
  project_id: string | null;
  task_id: string | null;
  module_id: string;
  agent: "codex";
  /** AgentRun process state, distinct from the current Codex session/turn state. */
  run_status: string | null;
  status: ChatSessionStatus;
  active_turn_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string | null;
  last_error: string | null;
  last_sequence: number;
}

/** One server-owned event in a Chat run's replay log. */
export interface ChatEvent {
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ChatSnapshot {
  run: ChatSessionSummary;
  session: {
    status: ChatSessionStatus;
    active_turn_id: string | null;
    last_error: string | null;
    provider_thread_id?: string | null;
    next_sequence?: number;
    updated_at?: string | null;
  };
  events: ChatEvent[];
  cursor: number;
}

export type ChatMessageRole = "user" | "assistant" | "system";

/** T3-compatible presentation shape derived from Ticketry's durable events. */
export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  text: string;
  turnId: string | null;
  streaming: boolean;
  createdAt: string;
  updatedAt: string;
  optimistic?: boolean;
  delivery: "pending" | "sent" | "failed" | "unknown";
  deliveryError?: string | null;
  deliveryRetryable?: boolean;
  deliveryUnknownFinal?: boolean;
}

export type ChatActivityStatus =
  | "inProgress"
  | "completed"
  | "failed"
  | "declined"
  | "stopped";

export interface ChatActivity {
  id: string;
  turnId: string | null;
  label: string;
  detail: string | null;
  command: string | null;
  changedFiles: readonly string[];
  tone: "thinking" | "tool" | "info" | "error";
  status: ChatActivityStatus;
  itemType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatPlan {
  id: string;
  turnId: string | null;
  explanation: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatDiff {
  id: string;
  turnId: string | null;
  title: string;
  patch: string | null;
  files: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export type ChatTimelineRow =
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showAssistantMeta: boolean;
    }
  | {
      kind: "activity";
      id: string;
      createdAt: string;
      activity: ChatActivity;
    }
  | {
      kind: "turn-fold";
      id: string;
      createdAt: string;
      turnId: string;
      label: string;
      expanded: boolean;
    }
  | {
      kind: "plan";
      id: string;
      createdAt: string;
      plan: ChatPlan;
    }
  | {
      kind: "diff";
      id: string;
      createdAt: string;
      diff: ChatDiff;
    }
  | {
      kind: "working";
      id: "working-indicator-row";
      createdAt: string | null;
    };

export interface PendingChatMessage {
  id: string;
  text: string;
  created_at: string;
  delivery?: "sending" | "unknown";
}

export interface ChatPendingApproval {
  requestId: string;
  requestKind: "command" | "file-change" | "permission" | "other";
  detail: string | null;
  availableDecisions: Array<
    "accept" | "acceptForSession" | "decline" | "cancel"
  >;
  createdAt: string;
}

export interface ChatUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  allowOther: boolean;
  isSecret: boolean;
}

export interface ChatPendingUserInput {
  requestId: string;
  questions: ChatUserInputQuestion[];
  createdAt: string;
}

export type ChatClientCommand =
  | {
      v: 1;
      type: "start_turn";
      command_id: string;
      prompt: string;
    }
  | {
      v: 1;
      type: "interrupt";
      command_id: string;
    }
  | {
      v: 1;
      type: "respond_approval";
      command_id: string;
      request_id: string;
      decision: "accept" | "acceptForSession" | "decline" | "cancel";
    }
  | {
      v: 1;
      type: "respond_user_input";
      command_id: string;
      request_id: string;
      answers: Record<string, string[]>;
    }
  | {
      v: 1;
      type: "stop";
      command_id: string;
    };

export type ChatServerFrame =
  | {
      v: 1;
      type: "snapshot";
      agent_run_id: string;
      run: unknown;
      session: unknown;
      events: unknown;
      cursor: number;
    }
  | {
      v: 1;
      type: "event";
      agent_run_id: string;
      event: unknown;
    }
  | {
      v: 1;
      type: "ready";
      agent_run_id: string;
      cursor: number;
    }
  | {
      v: 1;
      type: "ack";
      agent_run_id: string;
      command_id: string;
      command: ChatClientCommand["type"];
      result: Record<string, unknown>;
    }
  | {
      v: 1;
      type: "error";
      agent_run_id: string;
      command_id?: string | null;
      code: string;
      message: string;
      retryable: boolean;
    };

export interface CreateChatRunRequest {
  /** Durable client id used to collapse an ambiguous POST retry. */
  command_id?: string;
  agent: "codex";
  project_id: string;
  module_id: string;
  task_id: string | null;
  initial_prompt: string | null;
  is_planning: boolean;
  is_instant: boolean;
  instant_prompt: string | null;
}
