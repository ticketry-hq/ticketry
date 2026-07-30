import { useMemo } from "react";
import {
  useTerminalStore,
  type OpenDocChatArgs,
  type OpenSessionArgs,
  type SessionMeta,
} from "./internal/sessionStore";
import { launchAgent, launchDocumentAgent } from "./internal/actions";
import { useWorkspaceTabsStore } from "./internal/workspaceTabsStore";
import type { SessionId, TaskId } from "../types";
import type { LifecycleState } from "./lifecycle";
import { selectRunState, useAgentStatusStore } from "../status";

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

export function launchDocChat(args: OpenDocChatArgs): SessionId {
  return launchDocumentAgent(args);
}

// One terminal tab of a task bucket, ready to render: the session meta plus
// the lifecycle the strip shows ("reconnecting" transport state beats the
// run's own lifecycle).
export interface SessionTab {
  id: SessionId;
  meta: SessionMeta;
  lifecycle: LifecycleState;
}

// Tab-strip query: the ordered terminal tabs of a task bucket (null → none —
// callers pass the bucket id they render, including per-module scratch
// buckets). The workspace-tabs store is the sole tab index (CODIN-981/982).
export function useTaskSessions(taskId: TaskId | null): SessionTab[] {
  const sessions = useTerminalStore((s) => s.sessions);
  const ids = useWorkspaceTabsStore((s) =>
    taskId ? s.byTaskId[taskId] : undefined,
  );
  const runStates = useAgentStatusStore((s) => s.runs);
  return useMemo(
    () =>
      (ids ?? []).flatMap((id) => {
        const meta = sessions[id];
        if (!meta) return [];
        const lifecycle: LifecycleState =
          meta.status === "reconnecting"
            ? "reconnecting"
            : (selectRunState(
                {
                  projectId: null,
                  runs: runStates,
                  byTask: {},
                  automationAttempts: {},
                  automationByTask: {},
                },
                meta.agentRunId ?? "",
              ) ?? "unknown");
        return [{ id, meta, lifecycle }];
      }),
    [ids, sessions, runStates],
  );
}

// The bucket's focused terminal tab, if any.
export function useActiveSession(taskId: TaskId | null): SessionId | null {
  return useWorkspaceTabsStore((s) =>
    taskId ? s.activeByTask[taskId] ?? null : null,
  );
}
