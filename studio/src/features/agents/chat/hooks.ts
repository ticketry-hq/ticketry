import { useMemo } from "react";
import type { LifecycleState } from "../terminal";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import * as api from "./api";
import { dismissedChatRunsFor, useChatStore, type ChatSessionState } from "./store";
import type { ChatSessionSummary, CreateChatRunRequest } from "./types";
import { stopChat } from "./transport";

const PENDING_LAUNCHES_KEY = "ticketry.chat-pending-launches:v1";
const PENDING_LAUNCH_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_PENDING_LAUNCHES = 20;

interface PendingLaunchCommand {
  commandId: string;
  createdAt: number;
}

const memoryPendingLaunches = new Map<string, PendingLaunchCommand>();

function newCommandId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function launchFingerprint(request: CreateChatRunRequest): Promise<string> {
  const serialized = JSON.stringify({
    agent: request.agent,
    project_id: request.project_id,
    module_id: request.module_id,
    task_id: request.task_id,
    initial_prompt: request.initial_prompt,
    is_planning: request.is_planning,
    is_instant: request.is_instant,
    instant_prompt: request.instant_prompt,
  });
  if (
    typeof crypto !== "undefined" &&
    crypto.subtle &&
    typeof TextEncoder !== "undefined"
  ) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized),
    );
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }
  // Older embedded webviews still avoid storing the prompt itself. A collision
  // can only produce a backend idempotency conflict, never run the wrong body.
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function readPendingLaunches(): Map<string, PendingLaunchCommand> {
  const now = Date.now();
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PENDING_LAUNCHES_KEY) ?? "{}",
    ) as Record<string, Partial<PendingLaunchCommand>>;
    return new Map(
      Object.entries(parsed).flatMap(([fingerprint, command]) =>
        typeof command.commandId === "string" &&
          typeof command.createdAt === "number" &&
          now - command.createdAt <= PENDING_LAUNCH_TTL_MS
          ? [[fingerprint, {
              commandId: command.commandId,
              createdAt: command.createdAt,
            }]]
          : [],
      ),
    );
  } catch {
    for (const [fingerprint, command] of memoryPendingLaunches) {
      if (now - command.createdAt > PENDING_LAUNCH_TTL_MS) {
        memoryPendingLaunches.delete(fingerprint);
      }
    }
    return new Map(memoryPendingLaunches);
  }
}

function writePendingLaunches(
  launches: ReadonlyMap<string, PendingLaunchCommand>,
): void {
  const bounded = [...launches.entries()]
    .sort((left, right) => left[1].createdAt - right[1].createdAt)
    .slice(-MAX_PENDING_LAUNCHES);
  memoryPendingLaunches.clear();
  for (const [fingerprint, command] of bounded) {
    memoryPendingLaunches.set(fingerprint, command);
  }
  try {
    localStorage.setItem(
      PENDING_LAUNCHES_KEY,
      JSON.stringify(Object.fromEntries(bounded)),
    );
  } catch {
    /* The in-memory fallback still protects retries within this webview. */
  }
}

async function claimLaunchCommand(request: CreateChatRunRequest): Promise<{
  commandId: string;
  fingerprint: string;
}> {
  const fingerprint = await launchFingerprint(request);
  const launches = readPendingLaunches();
  const existing = launches.get(fingerprint);
  const commandId = request.command_id ?? existing?.commandId ?? newCommandId();
  launches.set(fingerprint, { commandId, createdAt: Date.now() });
  writePendingLaunches(launches);
  return { commandId, fingerprint };
}

function completeLaunchCommand(fingerprint: string, commandId: string): void {
  const launches = readPendingLaunches();
  if (launches.get(fingerprint)?.commandId !== commandId) return;
  launches.delete(fingerprint);
  writePendingLaunches(launches);
}

export interface ChatSessionTab {
  id: string;
  meta: ChatSessionState;
  lifecycle: LifecycleState;
}

function lifecycleOf(session: ChatSessionState): LifecycleState {
  if (session.connection === "reconnecting") return "reconnecting";
  switch (session.status) {
    case "starting":
      return "starting";
    case "running":
      return "working";
    case "ready":
    case "interrupted":
      return "turn_complete";
    case "stopped":
      return "exited";
    case "error":
      return "error";
  }
}

export function deriveTaskChatSessions(
  taskId: string | null,
  sessions: Readonly<Record<string, ChatSessionState>>,
  dismissed: ReadonlySet<string>,
): ChatSessionTab[] {
  if (!taskId) return [];
  return Object.values(sessions)
    .filter((session) =>
      session.task_id === taskId && !dismissed.has(session.agent_run_id)
    )
    .sort((left, right) =>
      (left.started_at ?? "").localeCompare(right.started_at ?? "") ||
      left.agent_run_id.localeCompare(right.agent_run_id),
    )
    .map((meta) => ({
      id: meta.agent_run_id,
      meta,
      lifecycle: lifecycleOf(meta),
    }));
}

export function useTaskChatSessions(taskId: string | null): ChatSessionTab[] {
  const sessions = useChatStore((state) => state.sessions);
  return useMemo(
    () => deriveTaskChatSessions(
      taskId,
      sessions,
      taskId ? dismissedChatRunsFor(taskId) : new Set(),
    ),
    [sessions, taskId],
  );
}

export function useActiveChatSession(taskId: string | null): string | null {
  return useChatStore((state) =>
    taskId ? state.activeByTask[taskId] ?? null : null
  );
}

export async function launchChatSession(
  request: CreateChatRunRequest,
): Promise<string> {
  const { commandId, fingerprint } = await claimLaunchCommand(request);
  const { agent_run_id: agentRunId } = await api.createChatRun({
    ...request,
    command_id: commandId,
  });
  completeLaunchCommand(fingerprint, commandId);
  const now = new Date().toISOString();
  const summary: ChatSessionSummary = {
    agent_run_id: agentRunId,
    project_id: request.project_id,
    task_id: request.task_id,
    module_id: request.module_id,
    agent: "codex",
    run_status: "running",
    status: "starting",
    active_turn_id: null,
    started_at: now,
    ended_at: null,
    updated_at: now,
    last_error: null,
    last_sequence: 0,
  };
  useChatStore.getState().openSession(summary);
  if (request.task_id) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.chatSessions.persisted(request.task_id),
    });
  }
  return agentRunId;
}

export function selectChatSession(taskId: string, agentRunId: string): void {
  useChatStore.getState().selectSession(taskId, agentRunId);
}

/** Stop the full-access process before its visible tab is dismissed. */
export async function closeChatTab(
  taskId: string,
  agentRunId: string,
): Promise<void> {
  // The local snapshot may be stale when another webview has resumed this run.
  // Stop is server-idempotent, so always let the backend make the authoritative
  // process-lifetime decision before hiding the tab.
  await stopChat(agentRunId);
  useChatStore.getState().closeTab(taskId, agentRunId);
}

export function reopenChatTab(summary: ChatSessionSummary): void {
  useChatStore.getState().openSession(summary, true);
}
