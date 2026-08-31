import { useEffect, useRef } from "react";

import {
  isLiveTerminalState,
  isScratchBucket,
  selectWorkspaceTerminalRuns,
  useActiveSession,
  useResumableTerminalSessions,
  useTaskSessions,
  useTerminalStore,
} from "../../../../../features/agents/terminal";
import { useAgentStatusSelection } from "../../../../../features/agents/status";
import {
  recordLaunchDiscoveryForAgentRun,
} from "../../../../../features/agents/status/launchDiscoveryTrace";

export function useWorkspaceTerminalSessions(
  bucket: string | null,
  projectId: string | null,
  moduleId: string | null,
  conversationRunId: string | null = null,
) {
  const sessions = useTerminalStore((state) => state.sessions);
  const bucketTabs = useTaskSessions(bucket);
  const tabs = conversationRunId
    ? bucketTabs.filter((tab) => tab.meta.agentRunId === conversationRunId)
    : bucketTabs;
  const bucketActiveTerminalId = useActiveSession(bucket);
  const conversationSessionId = useTerminalStore((state) =>
    conversationRunId ? state.sessionByRun[conversationRunId] ?? null : null
  );
  const activeTerminalId = conversationRunId
    ? conversationSessionId
    : bucketActiveTerminalId;
  const scratch = isScratchBucket(bucket);
  const bucketResumableSessions = useResumableTerminalSessions(
    bucket && !scratch ? bucket : null,
    scratch ? projectId : null,
    scratch ? moduleId : null,
  );
  const focusSession = useTerminalStore((state) => state.focusSession);
  const openSession = useTerminalStore((state) => state.openSession);
  const workspaceRuns = useAgentStatusSelection(
    (holding) => {
      const runs = selectWorkspaceTerminalRuns(
        holding,
        bucket,
        projectId,
        moduleId,
      );
      return conversationRunId
        ? runs.filter((run) => run.agent_run_id === conversationRunId)
        : runs;
    },
  );
  const committedRunIds = useRef(new Set<string>());

  useEffect(() => {
    if (!bucket || !projectId) return;
    for (const tab of tabs) {
      const agentRunId = tab.meta.agentRunId;
      if (!agentRunId) continue;
      const committedKey = `${projectId}\0${bucket}\0${agentRunId}`;
      if (committedRunIds.current.has(committedKey)) continue;
      committedRunIds.current.add(committedKey);
      recordLaunchDiscoveryForAgentRun(
        "workspace-render-committed",
        projectId,
        agentRunId,
        { bucket, moduleId, sessionId: tab.id },
      );
    }
  }, [bucket, moduleId, projectId, tabs]);

  return {
    sessions,
    tabs,
    activeTerminalId,
    scratch,
    workspaceRuns,
    resumableSessions: conversationRunId ? [] : bucketResumableSessions,
    focusSession,
    openSession,
  };
}

export function useVisibleTerminalHistory({
  bucket,
  projectId,
  moduleId,
  excludedRunIds,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  excludedRunIds: ReadonlySet<string>;
}) {
  // Which runs become history chips and how each chip is coloured must answer
  // the same liveness question, so both read `isLiveTerminalState` (#695).
  return useAgentStatusSelection((state) => {
    if (!bucket) return [];
    return Object.values(state.runs).filter(
      (run) =>
        (isScratchBucket(bucket)
          ? run.task_id === null &&
            run.project_id === projectId &&
            run.module_id === moduleId
          : run.task_id === bucket) &&
        !isLiveTerminalState(run.state) &&
        !excludedRunIds.has(run.agent_run_id),
    );
  });
}
