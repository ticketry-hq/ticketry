import type { WorkItem } from "../../../../../shared/api/types";
import { SubtreeRunButton } from "./internal/SubtreeRunButton";
import { useSubtreeRunEligibility, useSubtreeRunLaunch } from "./internal/subtreeRun";

interface SubtreeRunActionsProps {
  task: WorkItem;
  moduleId: string | null;
}

/**
 * Starts an eligible top-level work item's dependency-subtree campaign, either
 * with the historical parallel fan-out or with bounded serial execution. One
 * subtree-run capability authorizes both controls.
 */
export function SubtreeRunActions({ task, moduleId }: SubtreeRunActionsProps) {
  const eligible = useSubtreeRunEligibility(task, moduleId);
  const parallel = useSubtreeRunLaunch({
    item: task,
    actionName: "Run subtree",
    successMessage: "Subtree run started.",
    inertMessage:
      "Subtree run started nothing: every remaining work item is finished, blocked, or already running.",
    failureMessage: "Subtree execution could not be started",
  });
  const serial = useSubtreeRunLaunch({
    item: task,
    mode: "serial",
    actionName: "Run serially",
    successMessage: "Serial subtree run started.",
    inertMessage:
      "Serial subtree run started nothing: every remaining work item is finished, blocked, or already running.",
    failureMessage: "Serial subtree execution could not be started",
  });

  if (!eligible) return null;

  return (
    <>
      <SubtreeRunButton
        name="Run subtree"
        pending={parallel.pending}
        pendingLabel="Running…"
        onClick={parallel.launch}
      />
      <SubtreeRunButton
        name="Run serially"
        pending={serial.pending}
        pendingLabel="Running serially…"
        onClick={serial.launch}
      />
    </>
  );
}
