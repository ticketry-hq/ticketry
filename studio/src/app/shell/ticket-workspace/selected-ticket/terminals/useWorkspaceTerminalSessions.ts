import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  isScratchBucket,
  useActiveSession,
  usePersistedTerminalSessions,
  useResumableTerminalSessions,
  useScratchTerminalSessions,
  useTaskSessions,
  useTerminalStore,
} from "../../../../../features/agents/terminal";
import {
  selectScratchRunIds,
  useAgentStatusStore,
} from "../../../../../features/agents/status";
import { queryClient } from "../../../../../shared/query/queryClient";
import { queryKeys } from "../../../../../shared/query/keys";

const EMPTY_RUN_IDS: string[] = [];

export function useWorkspaceTerminalSessions(
  bucket: string | null,
  projectId: string | null,
  moduleId: string | null,
) {
  const sessions = useTerminalStore((state) => state.sessions);
  const tabs = useTaskSessions(bucket);
  const activeTerminalId = useActiveSession(bucket);
  const scratch = isScratchBucket(bucket);
  const persistedTerminalQuery = usePersistedTerminalSessions(
    bucket && !scratch ? bucket : null,
  );
  const scratchTerminalQuery = useScratchTerminalSessions(
    scratch ? projectId : null,
    scratch ? moduleId : null,
  );
  const resumableSessions = useResumableTerminalSessions(
    bucket && !scratch ? bucket : null,
    scratch ? projectId : null,
    scratch ? moduleId : null,
  );
  const focusSession = useTerminalStore((state) => state.focusSession);
  const openSession = useTerminalStore((state) => state.openSession);
  // Compared by value: a fresh array on every pushed run frame would re-run the
  // restore/refetch effects that consume it, churning viewer presentation.
  const mountedTaskRunIds = useAgentStatusStore(
    useShallow((state) =>
      bucket && !scratch
        ? Object.values(state.runs)
            .filter((run) => run.task_id === bucket)
            .map((run) => run.agent_run_id)
        : EMPTY_RUN_IDS,
    ),
  );
  const mountedScratchRunIds = useAgentStatusStore(
    useShallow((state) =>
      bucket && scratch && projectId && moduleId
        ? selectScratchRunIds(state, projectId, moduleId)
        : EMPTY_RUN_IDS,
    ),
  );

  return {
    sessions,
    tabs,
    activeTerminalId,
    scratch,
    persistedSessions: scratch
      ? scratchTerminalQuery.sessions
      : persistedTerminalQuery.sessions,
    terminalSessionsFetched: scratch
      ? scratchTerminalQuery.isFetched
      : persistedTerminalQuery.isFetched,
    resumableSessions,
    focusSession,
    openSession,
    mountedBucketRunIds: scratch
      ? mountedScratchRunIds
      : mountedTaskRunIds,
  };
}

export function useRefreshWorkspaceTerminalSessionsForRuns({
  bucket,
  projectId,
  moduleId,
  mountedRunIds,
}: {
  bucket: string | null;
  projectId: string | null;
  moduleId: string | null;
  mountedRunIds: readonly string[];
}): void {
  const observedBucketRunsRef = useRef<{
    bucket: string | null;
    ids: Set<string>;
  }>({ bucket: null, ids: new Set() });

  useEffect(() => {
    const scratchTarget =
      isScratchBucket(bucket) && projectId && moduleId
        ? { projectId, moduleId }
        : null;
    if (!bucket || (isScratchBucket(bucket) && !scratchTarget)) {
      observedBucketRunsRef.current = { bucket, ids: new Set() };
      return;
    }
    const previous = observedBucketRunsRef.current;
    const runAdded =
      previous.bucket === bucket &&
      mountedRunIds.some((runId) => !previous.ids.has(runId));
    observedBucketRunsRef.current = { bucket, ids: new Set(mountedRunIds) };
    if (!runAdded) return;
    void queryClient.invalidateQueries({
      queryKey: scratchTarget
        ? queryKeys.terminalSessions.scratch(
            scratchTarget.projectId,
            scratchTarget.moduleId,
          )
        : queryKeys.terminalSessions.persisted(bucket),
    });
  }, [bucket, projectId, moduleId, mountedRunIds]);
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
  return useAgentStatusStore((state) => {
    if (!bucket) return [];
    return Object.values(state.runs).filter(
      (run) =>
        (isScratchBucket(bucket)
          ? run.task_id === null &&
            run.project_id === projectId &&
            run.module_id === moduleId
          : run.task_id === bucket) &&
        (run.state === "exited" ||
          run.state === "lost" ||
          run.state === "error") &&
        !excludedRunIds.has(run.agent_run_id),
    );
  });
}
