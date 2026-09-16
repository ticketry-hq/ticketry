import type { WorkItem } from "../../../../../shared/api/types";
import { SubtreeRunButton } from "./internal/SubtreeRunButton";
import { useSubtreeRunEligibility, useSubtreeRunLaunch } from "./internal/subtreeRun";

interface SerialRunActionProps {
  task: WorkItem;
  moduleId: string | null;
}

/** Starts an eligible branch's existing bounded serial execution mode. */
export function SerialRunAction({ task, moduleId }: SerialRunActionProps) {
  const eligible = useSubtreeRunEligibility(task, moduleId);
  const serial = useSubtreeRunLaunch({
    item: task,
    mode: "serial",
    actionName: "Run subtree serially",
    successMessage: "Serial subtree run started.",
    inertMessage:
      "Serial subtree run started nothing: every remaining work item is finished, blocked, or already running.",
    failureMessage: "Serial subtree execution could not be started",
  });

  if (task.sub_issues_count === 0) return null;

  const unavailableReason = eligible
    ? undefined
    : "Subtree execution is not available in this item's current state.";

  return (
    <SubtreeRunButton
      name="Run subtree serially"
      pending={serial.pending}
      pendingLabel="Running serially…"
      onClick={serial.launch}
      disabled={!eligible}
      unavailableReason={unavailableReason}
    />
  );
}
