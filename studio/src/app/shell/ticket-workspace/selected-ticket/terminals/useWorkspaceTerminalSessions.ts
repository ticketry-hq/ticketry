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

export function useWorkspaceTerminalSessions(
  bucket: string | null,
  projectId: string | null,
  moduleId: string | null,
) {
  const sessions = useTerminalStore((state) => state.sessions);
  const tabs = useTaskSessions(bucket);
  const activeTerminalId = useActiveSession(bucket);
  const scratch = isScratchBucket(bucket);
  const resumableSessions = useResumableTerminalSessions(
    bucket && !scratch ? bucket : null,
    scratch ? projectId : null,
    scratch ? moduleId : null,
  );
  const focusSession = useTerminalStore((state) => state.focusSession);
  const openSession = useTerminalStore((state) => state.openSession);
  const workspaceRuns = useAgentStatusSelection(
    (holding) => selectWorkspaceTerminalRuns(
      holding,
      bucket,
      projectId,
      moduleId,
    ),
  );

  return {
    sessions,
    tabs,
    activeTerminalId,
    scratch,
    workspaceRuns,
    resumableSessions,
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
