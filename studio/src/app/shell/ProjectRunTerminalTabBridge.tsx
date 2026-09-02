import { useLayoutEffect } from "react";

import { useAgentStatusRuns } from "../../features/agents/status";
import {
  isLiveTerminalState,
  isTerminalProvider,
  scratchBucketId,
  useTerminalStore,
} from "../../features/agents/terminal";
import type { RunRecord } from "../../features/agents/status";

function bucketForRun(run: RunRecord): string | null {
  if (!isTerminalProvider(run.agent) || !isLiveTerminalState(run.state)) {
    return null;
  }
  if (run.scope === "task") return run.task_id;
  if (!run.module_id) return null;
  return scratchBucketId(run.module_id);
}

/** Materializes terminal tabs from the same project status records as badges. */
export function ProjectRunTerminalTabBridge() {
  const runs = useAgentStatusRuns();

  useLayoutEffect(() => {
    const runsByBucket = new Map<string, RunRecord[]>();
    for (const run of Object.values(runs)) {
      const bucket = bucketForRun(run);
      if (!bucket) continue;
      const bucketRuns = runsByBucket.get(bucket) ?? [];
      bucketRuns.push(run);
      runsByBucket.set(bucket, bucketRuns);
    }
    for (const [bucket, bucketRuns] of runsByBucket) {
      useTerminalStore.getState().reconcileRunTabs(bucket, bucketRuns);
    }
  }, [runs]);

  return null;
}
