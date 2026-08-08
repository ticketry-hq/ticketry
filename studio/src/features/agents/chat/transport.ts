import {
  chatWebSocketUrl,
  runtimeConfiguration,
} from "../../../runtime";
import * as api from "./api";
import { normalizeChatEvent, normalizeChatSnapshot } from "./api";
import { unresolvedChatMessageSend } from "./eventSemantics";
import { useChatStore } from "./store";
import type { ChatClientCommand, ChatServerFrame } from "./types";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 15_000;
const COMMAND_TIMEOUT_MS = 30_000;

function commandId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function socketUrl(agentRunId: string, cursor: number): string {
  const url = new URL(chatWebSocketUrl(), window.location.href);
  url.searchParams.set("agent_run_id", agentRunId);
  url.searchParams.set("cursor", String(Math.max(0, cursor)));
  const apiKey = runtimeConfiguration().values.workTrackerApiKey;
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url.toString();
}

function frameRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  commandType: ChatClientCommand["type"];
}

export class ChatDeliveryUnknownError extends Error {
  readonly deliveryUnknown = true;

  constructor(message = "Message delivery is unconfirmed") {
    super(message);
    this.name = "ChatDeliveryUnknownError";
  }
}

export function isChatDeliveryUnknownError(
  error: unknown,
): error is ChatDeliveryUnknownError {
  return error instanceof ChatDeliveryUnknownError ||
    (error instanceof Error &&
      (error as Error & { deliveryUnknown?: unknown }).deliveryUnknown === true);
}

class ChatConnection {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private retainCount = 0;
  private stopped = true;
  private readonly pending = new Map<string, PendingCommand>();

  constructor(readonly agentRunId: string) {}

  retain(): () => void {
    this.retainCount += 1;
    if (this.retainCount === 1) {
      this.stopped = false;
      this.connect();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retainCount = Math.max(0, this.retainCount - 1);
      if (this.retainCount === 0) this.stop();
    };
  }

  canDispatch(): boolean {
    return this.socket?.readyState === WebSocket.OPEN &&
      useChatStore.getState().sessions[this.agentRunId]?.connection === "ready";
  }

  dispatch(command: ChatClientCommand): Promise<void> {
    if (!this.canDispatch() || !this.socket) {
      return Promise.reject(new Error("Chat live connection is not ready"));
    }
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(command.command_id);
        reject(command.type === "start_turn"
          ? new ChatDeliveryUnknownError("Message acknowledgement timed out")
          : new Error("Chat command timed out"));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(command.command_id, {
        resolve,
        reject,
        timeout,
        commandType: command.type,
      });
      try {
        this.socket?.send(JSON.stringify(command));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(command.command_id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    const session = useChatStore.getState().sessions[this.agentRunId];
    if (!session) return;
    useChatStore.getState().setConnection(
      this.agentRunId,
      this.reconnectAttempt > 0 ? "reconnecting" : "connecting",
    );
    const next = new WebSocket(socketUrl(this.agentRunId, session.cursor));
    this.socket = next;
    next.onopen = () => {
      if (this.socket !== next || this.stopped) return;
      this.reconnectAttempt = 0;
    };
    next.onmessage = (message: MessageEvent) => {
      if (this.socket !== next || this.stopped || typeof message.data !== "string") return;
      let value: unknown;
      try {
        value = JSON.parse(message.data);
      } catch {
        return;
      }
      this.acceptFrame(value as ChatServerFrame);
    };
    next.onerror = () => {};
    next.onclose = () => {
      if (this.socket !== next) return;
      this.socket = null;
      this.rejectPendingAfterDisconnect("Chat connection closed");
      if (this.stopped) return;
      useChatStore.getState().setConnection(this.agentRunId, "reconnecting");
      const base = Math.min(
        RECONNECT_CAP_MS,
        RECONNECT_BASE_MS * 2 ** this.reconnectAttempt++,
      );
      this.reconnectTimer = setTimeout(
        () => {
          this.reconnectTimer = null;
          this.connect();
        },
        base + Math.random() * base * 0.25,
      );
    };
  }

  private acceptFrame(value: unknown): void {
    const frame = frameRecord(value);
    if (!frame || frame.v !== 1 || typeof frame.type !== "string") return;
    if (typeof frame.agent_run_id === "string" && frame.agent_run_id !== this.agentRunId) {
      return;
    }
    if (frame.type === "snapshot") {
      const fallback = useChatStore.getState().sessions[this.agentRunId];
      const snapshot = normalizeChatSnapshot(frame, fallback);
      if (snapshot) useChatStore.getState().installSnapshot(this.agentRunId, snapshot);
      return;
    }
    if (frame.type === "event") {
      const event = normalizeChatEvent(frame.event);
      if (event) useChatStore.getState().ingestEvent(this.agentRunId, event);
      return;
    }
    if (frame.type === "ready") {
      useChatStore.getState().setConnection(this.agentRunId, "ready");
      return;
    }
    if (frame.type === "ack" && typeof frame.command_id === "string") {
      this.resolvePending(frame.command_id);
      return;
    }
    if (frame.type === "error") {
      const message = typeof frame.message === "string"
        ? frame.message
        : "Chat transport reported an error";
      if (typeof frame.command_id === "string") {
        this.rejectCommand(frame.command_id, new Error(message));
      } else {
        useChatStore.getState().setConnection(this.agentRunId, "error", message);
      }
    }
  }

  private resolvePending(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.resolve();
  }

  private rejectCommand(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectPendingAfterDisconnect(message: string): void {
    for (const [id, pending] of [...this.pending.entries()]) {
      this.rejectCommand(
        id,
        pending.commandType === "start_turn"
          ? new ChatDeliveryUnknownError(message)
          : new Error(message),
      );
    }
  }

  private stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.rejectPendingAfterDisconnect("Chat connection released");
    useChatStore.getState().setConnection(this.agentRunId, "disconnected");
    connections.delete(this.agentRunId);
  }
}

const connections = new Map<string, ChatConnection>();

function connectionFor(agentRunId: string): ChatConnection {
  let connection = connections.get(agentRunId);
  if (!connection) {
    connection = new ChatConnection(agentRunId);
    connections.set(agentRunId, connection);
  }
  return connection;
}

export function acquireChatConnection(agentRunId: string): () => void {
  return connectionFor(agentRunId).retain();
}

async function refreshTranscript(agentRunId: string): Promise<void> {
  const current = useChatStore.getState().sessions[agentRunId];
  if (!current) return;
  try {
    const snapshot = await api.getChatSnapshot(agentRunId, current.cursor);
    useChatStore.getState().installSnapshot(agentRunId, snapshot);
  } catch {
    // The live stream remains authoritative. A best-effort REST catch-up is
    // only needed when a command was submitted while the socket was offline.
  }
}

function pendingMessageExists(agentRunId: string, messageId: string): boolean {
  return useChatStore.getState()
    .sessions[agentRunId]?.pending_user_messages
    .some((message) => message.id === messageId) ?? false;
}

export async function startChatTurn(agentRunId: string, prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  const id = commandId();
  // The backend echoes the client command id as the durable user-message id,
  // allowing replay to reconcile without ambiguous same-text matching.
  const optimisticId = id;
  useChatStore.getState().enqueueUserMessage(agentRunId, {
    id: optimisticId,
    text: trimmed,
    created_at: new Date().toISOString(),
    delivery: "sending",
  });
  try {
    const connection = connectionFor(agentRunId);
    if (connection.canDispatch()) {
      await connection.dispatch({ v: 1, type: "start_turn", command_id: id, prompt: trimmed });
    } else {
      await api.sendChatTurn(agentRunId, trimmed, id);
      await refreshTranscript(agentRunId);
    }
  } catch (error) {
    await refreshTranscript(agentRunId);
    const stillPending = pendingMessageExists(agentRunId, optimisticId);
    const durablePending = unresolvedChatMessageSend(
      useChatStore.getState().sessions[agentRunId]?.events ?? [],
    );
    const durableOutcomeUnresolved = durablePending !== null &&
      (durablePending.ids.includes(optimisticId) || durablePending.text === trimmed);
    if (!stillPending && !durableOutcomeUnresolved) {
      // Replay proved that the server committed (or explicitly failed) the
      // message. Do not repopulate the composer and risk a duplicate turn.
      return;
    }
    // Once dispatch begins, any failure without authoritative replay is an
    // unknown-delivery boundary. The request may have reached Codex even when
    // the WebSocket error frame, HTTP response, or transcript catch-up is
    // subsequently lost. Keep the original durable id and fail closed instead
    // of enabling a fresh-id send that could duplicate autonomous work.
    if (stillPending) {
      useChatStore.getState().markUserMessageUnknown(agentRunId, optimisticId);
    }
    throw isChatDeliveryUnknownError(error)
      ? error
      : new ChatDeliveryUnknownError(
          error instanceof Error ? error.message : "Message delivery is unconfirmed",
        );
  }
}

/**
 * Resolve an ambiguous delivery using the original durable command id. The
 * backend either returns the cached turn or starts it once; a fresh id is
 * never allocated for this action.
 */
export async function retryUnknownChatTurn(
  agentRunId: string,
  originalCommandId: string,
  prompt: string,
): Promise<void> {
  const pending = useChatStore.getState().sessions[agentRunId]
    ?.pending_user_messages.find((message) => message.id === originalCommandId);
  if (!pending || pending.delivery !== "unknown") return;

  try {
    const connection = connectionFor(agentRunId);
    if (connection.canDispatch()) {
      await connection.dispatch({
        v: 1,
        type: "start_turn",
        command_id: originalCommandId,
        prompt,
      });
    } else {
      await api.sendChatTurn(agentRunId, prompt, originalCommandId);
    }
  } catch (error) {
    await refreshTranscript(agentRunId);
    if (!pendingMessageExists(agentRunId, originalCommandId)) return;
    throw isChatDeliveryUnknownError(error)
      ? error
      : new ChatDeliveryUnknownError(
          error instanceof Error ? error.message : "Delivery remains unconfirmed",
        );
  }
  await refreshTranscript(agentRunId);
}

export async function interruptChat(agentRunId: string): Promise<void> {
  const connection = connectionFor(agentRunId);
  if (connection.canDispatch()) {
    await connection.dispatch({
      v: 1,
      type: "interrupt",
      command_id: commandId(),
    });
  } else {
    await api.interruptChatTurn(agentRunId);
    await refreshTranscript(agentRunId);
  }
  useChatStore.getState().setStatus(agentRunId, "interrupted", null);
}

export async function stopChat(agentRunId: string): Promise<void> {
  // Session termination must not share the WebSocket receive loop with a
  // provider command that may be hung awaiting Codex. The independent REST
  // request reaches the backend's preemptive stop path even while a live
  // start_turn command is still waiting for its acknowledgement.
  await api.stopChatRun(agentRunId);
  useChatStore.getState().setStatus(agentRunId, "stopped", null);
}

/** Reattach the durable Codex thread after its owning process has ended. */
export async function resumeChat(agentRunId: string): Promise<void> {
  await api.resumeChatRun(agentRunId);
  useChatStore.getState().markResuming(agentRunId);
  await refreshTranscript(agentRunId);
}

export type ChatApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export async function respondToChatApproval(
  agentRunId: string,
  requestId: string,
  decision: ChatApprovalDecision,
): Promise<void> {
  const connection = connectionFor(agentRunId);
  if (connection.canDispatch()) {
    await connection.dispatch({
      v: 1,
      type: "respond_approval",
      command_id: commandId(),
      request_id: requestId,
      decision,
    });
  } else {
    await api.respondToChatApproval(agentRunId, requestId, decision);
    await refreshTranscript(agentRunId);
  }
}

export async function respondToChatUserInput(
  agentRunId: string,
  requestId: string,
  answers: Record<string, string[]>,
): Promise<void> {
  const connection = connectionFor(agentRunId);
  if (connection.canDispatch()) {
    await connection.dispatch({
      v: 1,
      type: "respond_user_input",
      command_id: commandId(),
      request_id: requestId,
      answers,
    });
  } else {
    await api.respondToChatUserInput(agentRunId, requestId, answers);
    await refreshTranscript(agentRunId);
  }
}
