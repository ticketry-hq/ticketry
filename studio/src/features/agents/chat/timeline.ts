/**
 * Timeline normalization and fold behavior adapted from `pingdotgg/t3code`
 * `apps/web/src/session-logic.ts` and
 * `apps/web/src/components/chat/MessagesTimeline.logic.ts` at revision
 * 45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b (MIT; see
 * `third_party/t3code/LICENSE`). Ticketry's input is its ordered durable event
 * log instead of T3's Effect-backed orchestration read model.
 */

import type {
  ChatActivity,
  ChatActivityStatus,
  ChatDiff,
  ChatEvent,
  ChatMessage,
  ChatPlan,
  ChatSessionStatus,
  ChatTimelineRow,
  PendingChatMessage,
} from "./types";
import {
  chatMessageFailure,
  chatTurnOutcome,
  type ChatTurnOutcome,
} from "./eventSemantics";

type RecordValue = Record<string, unknown>;

type BaseEntry =
  | { kind: "message"; id: string; createdAt: string; message: ChatMessage }
  | { kind: "activity"; id: string; createdAt: string; activity: ChatActivity }
  | { kind: "plan"; id: string; createdAt: string; plan: ChatPlan }
  | { kind: "diff"; id: string; createdAt: string; diff: ChatDiff };

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function firstRecord(parent: RecordValue, ...keys: string[]): RecordValue | null {
  for (const key of keys) {
    const value = record(parent[key]);
    if (value) return value;
  }
  return null;
}

function firstString(parent: RecordValue | null, ...keys: string[]): string | null {
  if (!parent) return null;
  for (const key of keys) {
    const value = parent[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function firstArray(parent: RecordValue | null, ...keys: string[]): unknown[] {
  if (!parent) return [];
  for (const key of keys) {
    const value = parent[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function turnIdOf(payload: RecordValue): string | null {
  const direct = firstString(payload, "turnId", "turn_id");
  if (direct) return direct;
  return firstString(firstRecord(payload, "turn"), "id");
}

function itemOf(payload: RecordValue): RecordValue {
  return firstRecord(payload, "item", "activity", "tool") ?? payload;
}

function itemIdOf(payload: RecordValue, fallback: string): string {
  const item = itemOf(payload);
  return firstString(payload, "itemId", "item_id") ??
    firstString(item, "id", "itemId", "item_id") ??
    fallback;
}

function itemTypeOf(payload: RecordValue): string | null {
  const item = itemOf(payload);
  return firstString(item, "type", "itemType", "item_type") ??
    firstString(payload, "itemType", "item_type");
}

function normalizedType(value: string | null): string {
  return (value ?? "").replace(/[\s_\-/]/g, "").toLowerCase();
}

function textFromUnknown(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const pieces = value.flatMap((part) => {
      if (typeof part === "string") return [part];
      const row = record(part);
      const text = firstString(row, "text", "content", "output");
      return text ? [text] : [];
    });
    return pieces.length ? pieces.join("\n") : null;
  }
  const row = record(value);
  return firstString(row, "text", "content", "output");
}

function jsonDetail(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function commandOf(payload: RecordValue): string | null {
  const item = itemOf(payload);
  const candidate = item.command ?? item.cmd ?? payload.command;
  if (Array.isArray(candidate)) {
    return candidate.every((part) => typeof part === "string")
      ? candidate.join(" ")
      : null;
  }
  return typeof candidate === "string" ? candidate : null;
}

function changedFilesOf(payload: RecordValue): string[] {
  const item = itemOf(payload);
  const direct = [
    ...firstArray(item, "changedFiles", "changed_files", "files"),
    ...firstArray(payload, "changedFiles", "changed_files", "files"),
    ...firstArray(item, "changes"),
    ...firstArray(payload, "changes"),
  ];
  const paths = direct.flatMap((value) => {
    if (typeof value === "string") return [value];
    const row = record(value);
    const path = firstString(row, "path", "file", "filename");
    return path ? [path] : [];
  });
  const single = firstString(item, "path", "file", "filename") ??
    firstString(payload, "path", "file", "filename");
  if (single) paths.push(single);
  return [...new Set(paths)];
}

function detailOf(payload: RecordValue): string | null {
  const item = itemOf(payload);
  const itemType = normalizedType(itemTypeOf(payload));
  if (itemType.includes("mcptoolcall") || itemType.includes("dynamictoolcall")) {
    const sections = [
      ["Arguments", jsonDetail(item.arguments ?? payload.arguments)],
      ["Result", jsonDetail(item.result ?? item.output ?? payload.result)],
      ["Error", jsonDetail(item.error ?? payload.error)],
    ].flatMap(([label, detail]) => detail ? [`${label}\n${detail}`] : []);
    if (sections.length) return sections.join("\n\n");
  }
  const candidates = [
    payload.delta,
    payload.message,
    payload.error,
    payload.progress,
    payload.input,
    payload.stdin,
    item.output,
    item.aggregatedOutput,
    item.aggregated_output,
    item.result,
    item.detail,
    payload.output,
    payload.detail,
  ];
  for (const candidate of candidates) {
    const text = textFromUnknown(candidate);
    if (text) return text;
  }
  return null;
}

function lifecycleStatus(
  payload: RecordValue,
  completed: boolean,
): ChatActivityStatus {
  const item = itemOf(payload);
  const raw = firstString(item, "status", "state") ??
    firstString(payload, "status", "state");
  switch (raw?.toLowerCase()) {
    case "failed":
    case "error":
      return "failed";
    case "declined":
      return "declined";
    case "stopped":
    case "cancelled":
    case "canceled":
      return "stopped";
    case "completed":
    case "success":
    case "succeeded":
      return "completed";
    default:
      return completed ? "completed" : "inProgress";
  }
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function activityPresentation(
  payload: RecordValue,
  status: ChatActivityStatus,
): Pick<ChatActivity, "label" | "tone" | "command" | "changedFiles" | "itemType"> {
  const item = itemOf(payload);
  const itemType = itemTypeOf(payload);
  const type = normalizedType(itemType);
  const command = commandOf(payload);
  const changedFiles = changedFilesOf(payload);
  const toolName = firstString(item, "tool", "toolName", "tool_name");
  const toolServer = firstString(item, "server", "namespace");
  const explicitTitle = firstString(item, "title", "name", "toolName", "tool_name") ??
    firstString(payload, "title", "summary");
  const done = status === "completed";
  const failed = status === "failed" || status === "declined";
  if (type.includes("reasoning")) {
    return {
      label: explicitTitle ?? "Reasoning",
      tone: failed ? "error" : "thinking",
      command,
      changedFiles,
      itemType,
    };
  }
  if (type.includes("command") || type.includes("exec")) {
    const verb = failed ? "Command failed" : done ? "Ran command" : "Running command";
    return {
      label: command ? `${verb}: ${normalizeCompactToolLabel(command)}` : verb,
      tone: failed ? "error" : "tool",
      command,
      changedFiles,
      itemType,
    };
  }
  if (type.includes("filechange") || type.includes("applypatch") || changedFiles.length) {
    const files = changedFiles.length === 1
      ? changedFiles[0]
      : changedFiles.length > 1
        ? `${changedFiles.length} files`
        : "files";
    return {
      label: `${failed ? "Could not edit" : done ? "Edited" : "Editing"} ${files}`,
      tone: failed ? "error" : "tool",
      command,
      changedFiles,
      itemType,
    };
  }
  if (type.includes("websearch")) {
    return {
      label: done ? "Searched the web" : "Searching the web",
      tone: failed ? "error" : "tool",
      command,
      changedFiles,
      itemType,
    };
  }
  if (type.includes("mcptoolcall") || type.includes("dynamictoolcall")) {
    const tool = [toolServer, toolName].filter(Boolean).join(".") || "tool";
    return {
      label: `${failed ? "Tool failed" : done ? "Called" : "Calling"} ${tool}`,
      tone: failed ? "error" : "tool",
      command: tool,
      changedFiles,
      itemType,
    };
  }
  const label = explicitTitle ?? (itemType ? itemType.replace(/([a-z])([A-Z])/g, "$1 $2") : "Working");
  return {
    label,
    tone: failed ? "error" : type.includes("message") ? "info" : "tool",
    command,
    changedFiles,
    itemType,
  };
}

function assistantMessageText(payload: RecordValue): string | null {
  const item = itemOf(payload);
  return firstString(payload, "delta", "text") ??
    firstString(item, "text", "content") ??
    textFromUnknown(item.content);
}

function messageRole(itemType: string | null): ChatMessage["role"] | null {
  const type = normalizedType(itemType);
  if (type.includes("agentmessage") || type.includes("assistantmessage")) return "assistant";
  if (type.includes("usermessage")) return "user";
  if (type.includes("systemmessage")) return "system";
  return null;
}

const eventState = chatTurnOutcome;

interface TurnBoundary {
  state: ChatTurnOutcome;
  startedAt: string | null;
  completedAt: string | null;
}

/** Close a provider turn even when its process dies before turn/completed. */
function deriveTurnBoundaries(events: readonly ChatEvent[]): Map<string, TurnBoundary> {
  const turns = new Map<string, TurnBoundary>();
  let openTurnId: string | null = null;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const state = eventState(event);
    const turnId = turnIdOf(event.payload);
    if (state === "running" && turnId) {
      turns.set(turnId, {
        state,
        startedAt: event.created_at,
        completedAt: null,
      });
      openTurnId = turnId;
      continue;
    }
    if (turnId && state && state !== "running") {
      const previous = turns.get(turnId);
      turns.set(turnId, {
        state,
        startedAt: previous?.startedAt ?? null,
        completedAt: event.created_at,
      });
      if (openTurnId === turnId) openTurnId = null;
      continue;
    }
    if (
      openTurnId &&
      (event.event_type === "thread.session-interrupted" ||
        event.event_type === "thread.session-exited" ||
        event.event_type === "thread.session-stopped")
    ) {
      const previous = turns.get(openTurnId);
      turns.set(openTurnId, {
        state: event.event_type === "thread.session-exited" ? "failed" : "interrupted",
        startedAt: previous?.startedAt ?? null,
        completedAt: event.created_at,
      });
      openTurnId = null;
    }
  }
  return turns;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) {
    const tenths = Math.round(durationMs / 100) / 10;
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`;
  }
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<ChatMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;
  for (const message of messages) {
    if (message.role === "user") lastBoundary = message.createdAt;
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && !message.streaming) {
      lastBoundary = message.updatedAt;
    }
  }
  return result;
}

export const TIMELINE_FOLLOW_REARM_THRESHOLD_PX = 40;

export function resolveTimelineIsAtEnd(input: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return input.scrollHeight - input.scrollTop - input.clientHeight <=
    TIMELINE_FOLLOW_REARM_THRESHOLD_PX;
}

function planFromEvent(event: ChatEvent): ChatPlan {
  const payload = event.payload;
  // Codex app-server's native `turn/plan/updated` payload puts the steps
  // array directly at `payload.plan`; older normalized fixtures used
  // `payload.plan.steps`. Preserve both forms at this presentation boundary.
  const rawPlan = payload.plan;
  const plan = record(rawPlan) ?? payload;
  const rawSteps = Array.isArray(rawPlan)
    ? rawPlan
    : firstArray(plan, "steps");
  const steps = rawSteps.flatMap((value) => {
    const row = record(value);
    const step = firstString(row, "step", "text", "description");
    if (!step) return [];
    const rawStatus = firstString(row, "status");
    const status = rawStatus === "completed"
      ? "completed" as const
      : rawStatus === "inProgress" || rawStatus === "in_progress"
        ? "inProgress" as const
        : "pending" as const;
    return [{ step, status }];
  });
  return {
    id: firstString(plan, "id") ?? `plan:${event.sequence}`,
    turnId: turnIdOf(payload),
    explanation: firstString(plan, "explanation", "summary"),
    steps,
    createdAt: event.created_at,
    updatedAt: event.created_at,
  };
}

function diffFromEvent(event: ChatEvent): ChatDiff {
  const payload = event.payload;
  const changePatch = firstArray(payload, "changes")
    .flatMap((value) => {
      const change = record(value);
      const diff = firstString(change, "diff", "patch");
      return diff ? [diff] : [];
    })
    .join("\n");
  const patch = firstString(payload, "patch", "diff", "unifiedDiff", "unified_diff") ??
    firstString(itemOf(payload), "patch", "diff") ??
    (changePatch || null);
  const files = changedFilesOf(payload);
  return {
    id: `diff:${itemIdOf(payload, String(event.sequence))}`,
    turnId: turnIdOf(payload),
    title: files.length === 1
      ? `Changes in ${files[0]}`
      : files.length > 1
        ? `Changes in ${files.length} files`
        : "Code changes",
    patch,
    files,
    createdAt: event.created_at,
    updatedAt: event.created_at,
  };
}

/** Convert ordered replay events into T3-shaped messages and work rows. */
function deriveBaseEntries(
  events: readonly ChatEvent[],
  pending: readonly PendingChatMessage[],
): BaseEntry[] {
  const entries: BaseEntry[] = [];
  const indexById = new Map<string, number>();
  const messageSequenceById = new Map<string, number>();
  const messageAliasesById = new Map<string, ReadonlySet<string>>();

  const put = (entry: BaseEntry) => {
    const existing = indexById.get(entry.id);
    if (existing === undefined) {
      indexById.set(entry.id, entries.length);
      entries.push(entry);
    } else {
      entries[existing] = entry;
    }
  };

  const updateAssistant = (event: ChatEvent, text: string, streaming: boolean) => {
    const payload = event.payload;
    const id = `message:${itemIdOf(payload, turnIdOf(payload) ?? String(event.sequence))}`;
    const existingIndex = indexById.get(id);
    const existing = existingIndex === undefined ? null : entries[existingIndex];
    const previous = existing?.kind === "message" ? existing.message : null;
    const message: ChatMessage = {
      id,
      role: "assistant",
      text: streaming ? `${previous?.text ?? ""}${text}` : text || previous?.text || "",
      turnId: turnIdOf(payload) ?? previous?.turnId ?? null,
      streaming,
      createdAt: previous?.createdAt ?? event.created_at,
      updatedAt: event.created_at,
      delivery: "sent",
    };
    put({ kind: "message", id, createdAt: message.createdAt, message });
  };

  const updateActivity = (
    event: ChatEvent,
    options: {
      completed?: boolean;
      identity?: string;
      forcedType?: string;
      appendDetail?: string;
      detail?: string;
      replaceDetail?: boolean;
      label?: string;
    } = {},
  ) => {
    const payload = event.payload;
    const itemId = itemIdOf(payload, String(event.sequence));
    const id = `activity:${options.identity ?? options.forcedType ?? itemId}`;
    const existingIndex = indexById.get(id);
    const existing = existingIndex === undefined ? null : entries[existingIndex];
    const previous = existing?.kind === "activity" ? existing.activity : null;
    const status = lifecycleStatus(payload, options.completed ?? false);
    const presentation = activityPresentation(
      options.forcedType ? { ...payload, itemType: options.forcedType } : payload,
      status,
    );
    const hasFreshPresentation = Boolean(
      options.forcedType ||
      itemTypeOf(payload) ||
      commandOf(payload) ||
      changedFilesOf(payload).length ||
      firstString(itemOf(payload), "title", "name", "toolName", "tool_name") ||
      firstString(payload, "title", "summary"),
    );
    const nextDetail = options.detail ?? options.appendDetail ?? detailOf(payload);
    const detail = nextDetail
      ? options.replaceDetail
        ? nextDetail
        : `${previous?.detail ?? ""}${nextDetail}`
      : previous?.detail ?? null;
    const activity: ChatActivity = {
      id,
      turnId: turnIdOf(payload) ?? previous?.turnId ?? null,
      label: options.label ?? (hasFreshPresentation
        ? presentation.label
        : previous?.label ?? presentation.label ?? "Working"),
      detail,
      command: presentation.command ?? previous?.command ?? null,
      changedFiles: presentation.changedFiles.length
        ? presentation.changedFiles
        : previous?.changedFiles ?? [],
      tone: hasFreshPresentation ? presentation.tone : previous?.tone ?? presentation.tone,
      status,
      itemType: presentation.itemType ?? previous?.itemType ?? null,
      createdAt: previous?.createdAt ?? event.created_at,
      updatedAt: event.created_at,
    };
    put({ kind: "activity", id, createdAt: activity.createdAt, activity });
  };

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const payload = event.payload;
    if (event.event_type === "thread.message-sent") {
      const text = firstString(payload, "text") ?? "";
      const commandId = firstString(payload, "commandId", "command_id");
      const serverId = firstString(payload, "id", "messageId", "message_id");
      const id = commandId ?? serverId ??
        `message:user:${event.sequence}`;
      const message: ChatMessage = {
        id,
        role: "user",
        text,
        turnId: turnIdOf(payload),
        streaming: false,
        createdAt: event.created_at,
        updatedAt: event.created_at,
        delivery: payload.deliveryState === "pending" ? "pending" : "sent",
      };
      messageSequenceById.set(id, event.sequence);
      messageAliasesById.set(
        id,
        new Set([id, commandId, serverId].filter((value): value is string => Boolean(value))),
      );
      put({ kind: "message", id, createdAt: event.created_at, message });
      continue;
    }
    if (event.event_type === "thread.message-assistant-delta") {
      updateAssistant(event, firstString(payload, "delta") ?? "", true);
      continue;
    }
    if (event.event_type === "thread.activity-started" ||
      event.event_type === "thread.activity-completed") {
      const role = messageRole(itemTypeOf(payload));
      const messageText = assistantMessageText(payload);
      if (role === "assistant" && messageText !== null) {
        updateAssistant(event, messageText, event.event_type !== "thread.activity-completed");
      } else if (role !== "user" && role !== "system") {
        const isCompleted = event.event_type === "thread.activity-completed";
        const type = normalizedType(itemTypeOf(payload));
        updateActivity(event, {
          completed: isCompleted,
          replaceDetail: isCompleted &&
            (type.includes("mcptoolcall") || type.includes("dynamictoolcall")),
        });
      }
      continue;
    }
    if (event.event_type === "thread.reasoning-delta" ||
      event.event_type === "thread.reasoning-summary-delta") {
      const reasoningId = itemIdOf(payload, turnIdOf(payload) ?? String(event.sequence));
      updateActivity(event, {
        identity: `reasoning:${reasoningId}`,
        forcedType: "reasoning",
        appendDetail: firstString(payload, "delta") ?? "",
      });
      continue;
    }
    if (event.event_type === "thread.reasoning-summary-part-added") {
      const reasoningId = itemIdOf(payload, turnIdOf(payload) ?? String(event.sequence));
      updateActivity(event, {
        identity: `reasoning:${reasoningId}`,
        forcedType: "reasoning",
        appendDetail: detailOf(payload) ?? "",
      });
      continue;
    }
    if (event.event_type === "thread.command-output-delta") {
      updateActivity(event, {
        identity: itemIdOf(payload, `command:${event.sequence}`),
        appendDetail: firstString(payload, "delta") ?? "",
      });
      continue;
    }
    if (event.event_type === "thread.command-terminal-interaction") {
      updateActivity(event, {
        identity: itemIdOf(payload, `command:${event.sequence}`),
        appendDetail: detailOf(payload) ?? "",
      });
      continue;
    }
    if (event.event_type === "thread.file-change-output-delta") {
      updateActivity(event, {
        identity: itemIdOf(payload, `file:${event.sequence}`),
        appendDetail: firstString(payload, "delta") ?? "",
      });
      continue;
    }
    if (event.event_type === "thread.tool-progress") {
      updateActivity(event, {
        identity: itemIdOf(payload, `tool:${event.sequence}`),
        appendDetail: detailOf(payload) ?? "",
      });
      continue;
    }
    if (event.event_type === "thread.file-change-patch-updated" ||
      event.event_type === "thread.turn-diff-updated") {
      const diff = diffFromEvent(event);
      put({ kind: "diff", id: diff.id, createdAt: diff.createdAt, diff });
      continue;
    }
    if (event.event_type === "thread.proposed-plan-upserted") {
      const plan = planFromEvent(event);
      const id = `plan:${plan.id}`;
      put({ kind: "plan", id, createdAt: plan.createdAt, plan });
      continue;
    }
    if (event.event_type === "thread.proposed-plan-delta") {
      updateActivity(event, {
        identity: `plan-draft:${turnIdOf(payload) ?? itemIdOf(payload, String(event.sequence))}`,
        forcedType: "plan",
        appendDetail: firstString(payload, "delta") ?? "",
      });
      continue;
    }
    if (event.event_type === "thread.token-usage-updated") {
      const tokenUsage = firstRecord(payload, "tokenUsage", "token_usage");
      const total = firstRecord(tokenUsage ?? {}, "total");
      const last = firstRecord(tokenUsage ?? {}, "last");
      const number = (parent: RecordValue | null, ...keys: string[]) => {
        for (const key of keys) {
          const value = parent?.[key];
          if (typeof value === "number" && Number.isFinite(value)) return value;
        }
        return 0;
      };
      const format = (value: number) => Math.max(0, value).toLocaleString("en-US");
      const totalTokens = number(total, "totalTokens", "total_tokens");
      const lastTokens = number(last, "totalTokens", "total_tokens");
      const contextWindow = number(
        tokenUsage,
        "modelContextWindow",
        "model_context_window",
      );
      const details = [
        `Input ${format(number(total, "inputTokens", "input_tokens"))}`,
        `Cached ${format(number(total, "cachedInputTokens", "cached_input_tokens"))}`,
        `Output ${format(number(total, "outputTokens", "output_tokens"))}`,
        `Reasoning ${format(number(total, "reasoningOutputTokens", "reasoning_output_tokens"))}`,
        lastTokens ? `Last turn ${format(lastTokens)}` : null,
        contextWindow
          ? `Context window ${format(contextWindow)}`
          : null,
      ].filter((value): value is string => value !== null).join(" · ");
      updateActivity(event, {
        completed: true,
        identity: `usage:${turnIdOf(payload) ?? "thread"}`,
        forcedType: "tokenUsage",
        label: `${format(totalTokens)} tokens used`,
        detail: details,
        replaceDetail: true,
      });
      continue;
    }
    if (event.event_type === "thread.approval-response-requested") {
      updateActivity(event, {
        identity: firstString(payload, "requestId", "request_id") ?? String(event.sequence),
        forcedType: "approval",
      });
      continue;
    }
    if (event.event_type === "thread.user-input-response-requested") {
      updateActivity(event, {
        identity: firstString(payload, "requestId", "request_id") ?? String(event.sequence),
        forcedType: "userInput",
      });
      continue;
    }
    if (event.event_type === "thread.error") {
      updateActivity(event, {
        completed: true,
        identity: `error:${event.sequence}`,
        forcedType: "error",
      });
      continue;
    }
    if (event.event_type === "thread.provider-notification" && detailOf(payload)) {
      updateActivity(event, {
        identity: `provider:${event.sequence}`,
        forcedType: "info",
      });
    }
  }

  const turnStartedSequences = events.flatMap((event) =>
    chatTurnOutcome(event) === "running" ? [event.sequence] : []
  );
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.kind !== "message" || entry.message.role !== "user") continue;
    const sourceSequence = messageSequenceById.get(entry.message.id);
    const aliases = messageAliasesById.get(entry.message.id) ?? new Set([entry.message.id]);
    const failure = events
      .map(chatMessageFailure)
      .find((candidate) => candidate?.ids.some((id) => aliases.has(id)));
    if (failure) {
      entries[index] = {
        ...entry,
        message: {
          ...entry.message,
          delivery: "failed",
          deliveryError: failure.error,
          deliveryRetryable: failure.retryable,
          deliveryUnknownFinal: failure.deliveryUnknown,
        },
      };
    } else if (
      entry.message.delivery === "pending" &&
      sourceSequence !== undefined &&
      turnStartedSequences.some((sequence) => sequence > sourceSequence)
    ) {
      entries[index] = {
        ...entry,
        message: { ...entry.message, delivery: "sent" },
      };
    }
  }

  const completedTurns = deriveTurnBoundaries(events);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.kind !== "message" || entry.message.role !== "assistant") continue;
    if (
      entry.message.turnId &&
      completedTurns.get(entry.message.turnId)?.state !== "running"
    ) {
      entries[index] = {
        ...entry,
        message: { ...entry.message, streaming: false },
      };
    }
  }

  for (const message of pending) {
    const chatMessage: ChatMessage = {
      id: message.id,
      role: "user",
      text: message.text,
      turnId: null,
      streaming: false,
      createdAt: message.created_at,
      updatedAt: message.created_at,
      optimistic: true,
      delivery: message.delivery === "unknown" ? "unknown" : "pending",
    };
    entries.push({
      kind: "message",
      id: message.id,
      createdAt: message.created_at,
      message: chatMessage,
    });
  }
  return entries;
}

function foldRows(
  entries: readonly BaseEntry[],
  events: readonly ChatEvent[],
  activeTurnId: string | null,
  expandedTurnIds: ReadonlySet<string>,
): ChatTimelineRow[] {
  const turnBoundaries = deriveTurnBoundaries(events);
  const turnState = new Map<string, ChatTurnOutcome>();
  const startedAt = new Map<string, string>();
  const completedAt = new Map<string, string>();
  for (const [turnId, boundary] of turnBoundaries) {
    turnState.set(turnId, boundary.state);
    if (boundary.startedAt) startedAt.set(turnId, boundary.startedAt);
    if (boundary.completedAt) completedAt.set(turnId, boundary.completedAt);
  }

  const lastAssistantByTurn = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "message" && entry.message.role === "assistant" && entry.message.turnId) {
      lastAssistantByTurn.set(entry.message.turnId, entry.id);
    }
  }

  const firstFoldableByTurn = new Map<string, string>();
  for (const entry of entries) {
    const turnId = entry.kind === "message"
      ? entry.message.turnId
      : entry.kind === "activity"
        ? entry.activity.turnId
        : entry.kind === "plan"
          ? entry.plan.turnId
          : entry.diff.turnId;
    if (!turnId || turnId === activeTurnId || turnState.get(turnId) === "running") continue;
    const foldable = (entry.kind === "activity" && entry.activity.itemType !== "tokenUsage") ||
      (entry.kind === "message" && entry.message.role === "assistant" &&
        lastAssistantByTurn.get(turnId) !== entry.id);
    if (foldable && !firstFoldableByTurn.has(turnId)) {
      firstFoldableByTurn.set(turnId, entry.id);
    }
  }

  const messages = entries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : []
  );
  const durationStart = computeMessageDurationStart(messages);
  const rows: ChatTimelineRow[] = [];
  for (const entry of entries) {
    const turnId = entry.kind === "message"
      ? entry.message.turnId
      : entry.kind === "activity"
        ? entry.activity.turnId
        : entry.kind === "plan"
          ? entry.plan.turnId
          : entry.diff.turnId;
    if (turnId && firstFoldableByTurn.get(turnId) === entry.id) {
      const start = startedAt.get(turnId);
      const end = completedAt.get(turnId);
      const elapsed = start && end ? Date.parse(end) - Date.parse(start) : Number.NaN;
      const duration = Number.isFinite(elapsed) ? formatDuration(Math.max(0, elapsed)) : null;
      const interrupted = turnState.get(turnId) === "interrupted";
      const failed = turnState.get(turnId) === "failed";
      rows.push({
        kind: "turn-fold",
        id: `turn-fold:${turnId}`,
        createdAt: entry.createdAt,
        turnId,
        label: failed
          ? duration ? `Turn failed after ${duration}` : "Turn failed"
          : interrupted
          ? duration ? `You stopped after ${duration}` : "You stopped this response"
          : duration ? `Worked for ${duration}` : "Worked",
        expanded: expandedTurnIds.has(turnId),
      });
    }
    const hiddenByFold = turnId && firstFoldableByTurn.has(turnId) &&
      !expandedTurnIds.has(turnId) &&
      ((entry.kind === "activity" && entry.activity.itemType !== "tokenUsage") ||
        (entry.kind === "message" && entry.message.role === "assistant" &&
          lastAssistantByTurn.get(turnId) !== entry.id));
    if (hiddenByFold) continue;

    if (entry.kind === "message") {
      rows.push({
        kind: "message",
        id: entry.id,
        createdAt: entry.createdAt,
        message: entry.message,
        durationStart: durationStart.get(entry.message.id) ?? entry.message.createdAt,
        showAssistantMeta:
          entry.message.role === "assistant" &&
          (!entry.message.turnId || lastAssistantByTurn.get(entry.message.turnId) === entry.id) &&
          !entry.message.streaming,
      });
    } else if (entry.kind === "activity") {
      rows.push(entry);
    } else if (entry.kind === "plan") {
      rows.push(entry);
    } else {
      rows.push(entry);
    }
  }
  return rows;
}

export function deriveChatTimelineRows(input: {
  events: readonly ChatEvent[];
  pendingUserMessages?: readonly PendingChatMessage[];
  status: ChatSessionStatus;
  activeTurnId: string | null;
  expandedTurnIds?: ReadonlySet<string>;
}): ChatTimelineRow[] {
  const entries = deriveBaseEntries(
    input.events,
    input.pendingUserMessages ?? [],
  );
  const rows = foldRows(
    entries,
    input.events,
    input.activeTurnId,
    input.expandedTurnIds ?? new Set(),
  );
  if (input.status === "running") {
    const started = [...input.events].reverse().find(
      (event) => event.event_type === "thread.turn-started",
    );
    rows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: started?.created_at ?? null,
    });
  }
  return rows;
}
