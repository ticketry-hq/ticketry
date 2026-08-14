import { useMemo } from "react";
import {
  useTerminalStore,
  type OpenSessionArgs,
  type SessionMeta,
} from "./internal/sessionStore";
import { launchAgent } from "./internal/actions";
import type { SessionId, TaskId } from "../types";
import type { LifecycleState } from "./lifecycle";
import {
  isLiveAgentRunState,
  selectRunState,
  useAgentStatusStore,
} from "../status";
import type { RunRecord } from "../status";
import { bucketOfMeta, dismissedRunsFor } from "./internal/sessionStore";
import { useClientStore as useWorkspaceTabsStore } from "../../../state/clientStore";

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
  runs: Readonly<Record<string, RunRecord>>,
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
        ? runs[left.agentRunId]?.started_at ?? ""
        : "";
      const rightStarted = right.agentRunId
        ? runs[right.agentRunId]?.started_at ?? ""
        : "";
      return leftStarted.localeCompare(rightStarted) ||
        left.sessionId.localeCompare(right.sessionId);
    })
    .map((meta) => {
      const runState = selectRunState(
        {
          projectId: null,
          runs,
          automationAttempts: {},
          automationByTask: {},
        },
        meta.agentRunId ?? "",
      );
      // `session_lost` is a transport verdict about one viewer attach; the
      // pushed run projection is authoritative for the run itself. A run the
      // projection reports alive must not be presented as lost just because
      // an earlier viewer failed to attach (the backend may have healed the
      // session since).
      const lifecycle: LifecycleState =
        meta.status === "reconnecting"
          ? "reconnecting"
          : meta.status === "session_lost" && !isLiveAgentRunState(runState)
            ? "lost"
            : (runState ?? "unknown");
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
