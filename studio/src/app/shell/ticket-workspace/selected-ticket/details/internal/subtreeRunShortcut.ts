import { useEffect } from "react";
import { registerNormalRunCommand } from "../../../../../../features/work-items";
import type { GraphRunExecutionMode } from "../../../../../../features/execution";
import { editionHas } from "../../../../../../shared/config/edition";

/** Whether this edition offers the parallel Run subtree action at all. */
export const PARALLEL_SUBTREE_RUN_OFFERED = editionHas("parallelSubtreeRuns");

/**
 * The subtree action that owns a branch's normal-run command (Cmd+Enter):
 * the parallel Run subtree where it is offered, otherwise Run subtree serially.
 */
const NORMAL_RUN_SUBTREE_MODE: GraphRunExecutionMode = PARALLEL_SUBTREE_RUN_OFFERED
  ? "parallel"
  : "serial";

/**
 * Registers `launch` as the branch's normal-run command while armed, when this
 * control's mode owns that command. Returns whether it owns the command, so
 * the control can show the shortcut hint.
 */
export function useSubtreeNormalRunCommand({
  mode,
  taskId,
  armed,
  launch,
}: {
  mode: GraphRunExecutionMode;
  taskId: string;
  armed: boolean;
  launch: () => void;
}): boolean {
  const owns = mode === NORMAL_RUN_SUBTREE_MODE;
  useEffect(() => {
    if (!owns || !armed) return;
    return registerNormalRunCommand(taskId, launch);
  }, [armed, launch, owns, taskId]);
  return owns;
}
