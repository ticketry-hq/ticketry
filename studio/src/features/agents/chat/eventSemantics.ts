import type { ChatEvent, ChatSessionStatus } from "./types";

export type ChatTurnOutcome =
  | "running"
  | "completed"
  | "interrupted"
  | "failed";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  const row = record(value);
  return typeof row?.message === "string" && row.message.trim()
    ? row.message
    : null;
}

/** Resolve Ticketry's legacy event names and Codex's nested terminal status. */
export function chatTurnOutcome(event: ChatEvent): ChatTurnOutcome | null {
  if (event.event_type === "thread.turn-started") return "running";
  if (event.event_type === "thread.turn-interrupted") return "interrupted";
  if (event.event_type !== "thread.turn-completed") return null;
  const turn = record(event.payload.turn);
  const raw = turn?.status ?? event.payload.status;
  if (raw === "interrupted" || raw === "failed" || raw === "completed") {
    return raw;
  }
  // Older normalized fixtures did not retain Codex's nested status.
  return "completed";
}

export function chatTurnError(event: ChatEvent): string {
  const turn = record(event.payload.turn);
  return errorText(turn?.error) ?? errorText(event.payload.error) ?? "Codex turn failed";
}

export function chatMessageFailure(event: ChatEvent): {
  id: string;
  ids: string[];
  error: string;
  deliveryUnknown: boolean;
  retryable: boolean;
} | null {
  if (event.event_type !== "thread.message-failed") return null;
  const ids = [
    event.payload.command_id,
    event.payload.commandId,
    event.payload.id,
    event.payload.message_id,
    event.payload.messageId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!ids.length) return null;
  const deliveryUnknown = event.payload.deliveryUnknown === true ||
    event.payload.delivery_unknown === true;
  return {
    id: ids[0],
    ids: [...new Set(ids)],
    error: errorText(event.payload.error) ?? "Message could not be delivered",
    deliveryUnknown,
    retryable: !deliveryUnknown && event.payload.retryable !== false,
  };
}

/**
 * Find a crash-boundary delivery whose outcome cannot be retried safely.
 * A later durable send or provider turn proves the user has moved past it;
 * otherwise every freshly opened webview must require an explicit review.
 */
export function unresolvedChatDeliveryUnknown(
  events: readonly ChatEvent[],
): { id: string; sequence: number } | null {
  let unresolved: { id: string; sequence: number } | null = null;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const failure = chatMessageFailure(event);
    if (failure?.deliveryUnknown) {
      unresolved = { id: failure.id, sequence: event.sequence };
    } else if (
      unresolved &&
      (event.event_type === "thread.message-sent" ||
        event.event_type === "thread.turn-started")
    ) {
      unresolved = null;
    }
  }
  return unresolved;
}

/**
 * Find a user-message audit whose provider outcome has not been observed yet.
 * `thread.message-sent` is written before `turn/start`, so it cannot by itself
 * prove that Codex accepted the turn. This guard survives reload and closes the
 * small replay window before a correlated failure or later turn-start event.
 */
export function unresolvedChatMessageSend(
  events: readonly ChatEvent[],
): { id: string; ids: string[]; text: string | null; sequence: number } | null {
  let unresolved: {
    id: string;
    ids: string[];
    text: string | null;
    sequence: number;
  } | null = null;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.event_type === "thread.message-sent") {
      const ids = [
        event.payload.command_id,
        event.payload.commandId,
        event.payload.id,
        event.payload.message_id,
        event.payload.messageId,
      ].filter((value): value is string => typeof value === "string" && value.length > 0);
      if (ids.length) {
        unresolved = {
          id: ids[0],
          ids: [...new Set(ids)],
          text: typeof event.payload.text === "string" ? event.payload.text : null,
          sequence: event.sequence,
        };
      }
      continue;
    }
    if (!unresolved) continue;
    const failure = chatMessageFailure(event);
    if (
      event.event_type === "thread.turn-started" ||
      failure?.ids.some((id) => unresolved?.ids.includes(id))
    ) {
      unresolved = null;
    }
  }
  return unresolved;
}

/** Process lifetime is independent from whether its durable thread is resumable. */
export function chatProcessHasEnded(input: {
  status: ChatSessionStatus;
  runStatus?: string | null;
  endedAt?: string | null;
}): boolean {
  if (input.status === "stopped" || input.endedAt) return true;
  return input.runStatus !== undefined &&
    input.runStatus !== null &&
    input.runStatus !== "running" &&
    input.runStatus !== "starting";
}

/**
 * Resume is a process-lifetime action, not a generic error retry. Only the
 * latest process/session transition may offer it; turn and delivery failures
 * remain on the live process and retry through the composer.
 */
export function canResumeChatSession(input: {
  status: ChatSessionStatus;
  events: readonly ChatEvent[];
  retryableError: boolean;
  runStatus?: string | null;
}): boolean {
  // Stop is an explicit terminal user action. Only an unexpected provider
  // interruption/exit may advertise that its durable thread can be resumed.
  if (input.status === "stopped") return false;
  const ordered = [...input.events].sort((left, right) => left.sequence - right.sequence);
  if (input.status === "interrupted") {
    let latest:
      | { kind: "restart"; resumable: boolean }
      | { kind: "active" }
      | null = null;
    for (const event of ordered) {
      if (event.event_type === "thread.session-interrupted") {
        latest = { kind: "restart", resumable: event.payload.resumable === true };
      } else if (
        event.event_type === "thread.session-resumed" ||
        event.event_type === "thread.session-set" ||
        event.event_type === "thread.turn-started" ||
        event.event_type === "thread.turn-interrupted" ||
        event.event_type === "thread.turn-completed"
      ) {
        latest = { kind: "active" };
      }
    }
    return latest?.kind === "restart" && latest.resumable;
  }
  if (input.status !== "error" || input.retryableError) return false;

  let processEnded = false;
  let resumeFailed = false;
  let resumable: boolean | null = null;
  for (const event of ordered) {
    if (
      event.event_type === "thread.session-resumed" ||
      event.event_type === "thread.session-set"
    ) {
      processEnded = false;
      resumeFailed = false;
      resumable = null;
    } else if (event.event_type === "thread.session-exited") {
      processEnded = true;
      resumable = typeof event.payload.resumable === "boolean"
        ? event.payload.resumable
        : null;
    } else if (
      event.event_type === "thread.error" && event.payload.phase === "resume"
    ) {
      resumeFailed = true;
      resumable = typeof event.payload.resumable === "boolean"
        ? event.payload.resumable
        : true;
    } else if (
      event.event_type === "thread.error" &&
      typeof event.payload.resumable === "boolean"
    ) {
      resumable = event.payload.resumable;
    }
  }
  return (processEnded || resumeFailed) && resumable === true;
}
