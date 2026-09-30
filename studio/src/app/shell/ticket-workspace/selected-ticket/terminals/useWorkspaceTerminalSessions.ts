import { useEffect, useMemo, useRef } from "react";

import {
  isLiveTerminalState,
  isScratchBucket,
  excludeResumableTerminalRuns,
  selectWorkspaceTerminalRuns,
  useActiveSession,
  useModuleScratchEndedRuns,
  useResumableTerminalSessions,
  useStoryEndedRuns,
  useTaskSessions,
  useTerminalStore,
} from "../../../../../features/agents/terminal";
import {
  recordLaunchDiscoveryForAgentRun,
  useAgentStatusSelection,
} from "../../../../../features/agents/status";
import type { RunRecord } from "../../../../../features/agents/status";

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
  const candidateWorkspaceRuns = useAgentStatusSelection(
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
  // The status stream carries live runs only, so a reopened workspace reads its
  // own ended runs through the WorkItem model: a Story from its own WorkItem, a
  // scratch bucket from the module WorkItem that owns its plan, instant, and
  // shell runs. Both paths write the same `AgentRuns:{id}` cache entity, so this
  // is a merge of one Apollo holding, not a second copy of run state.
  const storyEndedRuns = useStoryEndedRuns(bucket && !scratch ? bucket : null);
  const scratchEndedRuns = useModuleScratchEndedRuns(
    bucket && scratch ? moduleId : null,
  );
  const endedRuns = scratch ? scratchEndedRuns : storyEndedRuns;
  const restorableRuns = useMemo(
    () =>
      mergeRunHoldings(
        candidateWorkspaceRuns,
        conversationRunId
          ? endedRuns.filter((run) => run.agent_run_id === conversationRunId)
          : endedRuns,
      ),
    [candidateWorkspaceRuns, conversationRunId, endedRuns],
  );
  const knownResumableRunIds = useRef(new Set<string>());
  const workspaceRuns = useMemo(() => {
    for (const session of bucketResumableSessions) {
      knownResumableRunIds.current.add(session.agent_run_id);
    }
    return excludeResumableTerminalRuns(
      restorableRuns,
      knownResumableRunIds.current,
    );
  }, [bucketResumableSessions, restorableRuns]);
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
    endedRuns,
    resumableSessions: conversationRunId ? [] : bucketResumableSessions,
    restorationExcludedRunIds: knownResumableRunIds.current,
    focusSession,
    openSession,
  };
}

export function useVisibleTerminalHistory({
  bucket,
  projectId,
  moduleId,
  excludedRunIds,
  restoredRuns = [],
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  excludedRunIds: ReadonlySet<string>;
  /** Ended runs read through the WorkItem, which the stream no longer pushes. */
  restoredRuns?: readonly RunRecord[];
}) {
  // Which runs become history chips and how each chip is coloured must answer
  // the same liveness question, so both read `isLiveTerminalState` (#695).
  const held = useAgentStatusSelection((state) => {
    if (!bucket) return [];
    return Object.values(state.runs).filter(
      (run) =>
        (isScratchBucket(bucket)
          ? run.task_id === null &&
            run.project_id === projectId &&
            run.module_id === moduleId
          : run.task_id === bucket) &&
        !isLiveTerminalState(run.state),
    );
  });
  // A run that exits while its tab is open reaches the holding through its own
  // event; after a reload only the WorkItem read still knows it — a Story's own
  // for a task bucket, the module's for a scratch bucket. Both describe the same
  // run, so the held row wins and the merge cannot double it.
  return mergeRunHoldings(held, restoredRuns).filter(
    (run) => !excludedRunIds.has(run.agent_run_id),
  );
}

/**
 * One row per run id, `held` winning: the live projection is the fresher one.
 * Ordered by start, the order `selectWorkspaceTerminalRuns` already imposes, so
 * a restored run takes its place in the history rather than trailing it.
 */
function mergeRunHoldings(
  held: readonly RunRecord[],
  incoming: readonly RunRecord[],
): readonly RunRecord[] {
  if (incoming.length === 0) return held;
  const known = new Set(held.map((run) => run.agent_run_id));
  const added = incoming.filter((run) => !known.has(run.agent_run_id));
  if (added.length === 0) return held;
  return [...held, ...added].sort(
    (left, right) =>
      (left.started_at ?? "").localeCompare(right.started_at ?? "") ||
      left.agent_run_id.localeCompare(right.agent_run_id),
  );
}
