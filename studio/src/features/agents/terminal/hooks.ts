import { useMemo } from "react";
import {
  useTerminalStore,
  type OpenSessionArgs,
  type SessionMeta,
} from "./internal/sessionStore";
import { launchAgent } from "./internal/actions";
import type { SessionId, TaskId } from "../types";
import type { LifecycleState } from "./lifecycle";
import { selectRunState, useAgentStatusStore } from "../status";
import type { AgentStatusRun } from "../status";
import { bucketOfMeta, dismissedRunsFor } from "./internal/sessionStore";
import { useWorkspaceTabsStore } from "./internal/workspaceTabsStore";

// Public query + launch surface of the terminal module. Hosts that render a
// tab strip, a badge, or a launch button import these — never the store
// internals. Each hook subscribes narrowly so callers re-render only on the
// slice they read.

// Launch verbs. Spawning is deliberately separate from presenting: `<Terminal>`
// only displays an existing session; these create one and return its id (the
// pre-ready temp id — the store rekeys it centrally once the server acks).
export function launchSession(args: OpenSessionArgs): SessionId {
  return launchAgent(args);
}

// One terminal tab of a task bucket, ready to render: the session meta plus
// the lifecycle the strip shows ("reconnecting" transport state beats the
// run's own lifecycle).
export interface SessionTab {
  id: SessionId;
  meta: SessionMeta;
  lifecycle: LifecycleState;
}

export function deriveTaskSessions(
  taskId: TaskId | null,
  sessions: Readonly<Record<string, SessionMeta>>,
  runs: Readonly<Record<string, AgentStatusRun>>,
  dismissed: ReadonlySet<string>,
): SessionTab[] {
  if (!taskId) return [];
  return Object.values(sessions)
    .filter((meta) =>
      bucketOfMeta(meta) === taskId &&
      (!meta.agentRunId || !dismissed.has(meta.agentRunId)),
    )
    .sort((left, right) => {
      const leftStarted = left.agentRunId
        ? runs[left.agentRunId]?.startedAt ?? ""
        : "";
      const rightStarted = right.agentRunId
        ? runs[right.agentRunId]?.startedAt ?? ""
        : "";
      return leftStarted.localeCompare(rightStarted) ||
        left.sessionId.localeCompare(right.sessionId);
    })
    .map((meta) => {
      const lifecycle: LifecycleState =
        meta.status === "reconnecting"
          ? "reconnecting"
          : (selectRunState(
              {
                projectId: null,
                runs,
                byTask: {},
                automationAttempts: {},
                automationByTask: {},
              },
              meta.agentRunId ?? "",
            ) ?? "unknown");
      return { id: meta.sessionId, meta, lifecycle };
    });
}

// Tab-strip query: the ordered terminal tabs of a task bucket (null → none —
// callers pass the bucket id they render, including per-module scratch
// buckets). The workspace-tabs store is the sole tab index (CODIN-981/982).
export function useTaskSessions(taskId: TaskId | null): SessionTab[] {
  const sessions = useTerminalStore((s) => s.sessions);
  const runStates = useAgentStatusStore((s) => s.runs);
  return useMemo(
    () => deriveTaskSessions(
      taskId,
      sessions,
      runStates,
      taskId ? dismissedRunsFor(taskId) : new Set(),
    ),
    [taskId, sessions, runStates],
  );
}

// The bucket's focused terminal tab, if any.
export function useActiveSession(taskId: TaskId | null): SessionId | null {
  return useWorkspaceTabsStore((s) =>
    taskId ? s.activeByTask[taskId] ?? null : null,
  );
}
