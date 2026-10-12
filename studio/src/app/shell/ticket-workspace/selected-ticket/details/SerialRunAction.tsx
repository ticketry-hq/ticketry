import type { WorkItem } from "../../../../../shared/api/types";
import type { ActiveSubtreeRun } from "../../../../../features/execution";
import { SubtreeRunButton } from "./internal/SubtreeRunButton";
import { useSubtreeRunEligibility, useSubtreeRunLaunch } from "./internal/subtreeRun";
import { useSubtreeNormalRunCommand } from "./internal/subtreeRunShortcut";
import { useGlobalShortcutLabel } from "../../../../navigation/useGlobalShortcutLabel";

interface SerialRunActionProps {
  task: WorkItem;
  moduleId: string | null;
  activeRun: ActiveSubtreeRun | null;
  runStateLoading: boolean;
  refreshRunState: () => Promise<void>;
}

/**
 * Starts an eligible branch's existing bounded serial execution mode. Where the
 * edition offers no parallel Run subtree, this action also owns Cmd+Enter.
 */
export function SerialRunAction({
  task,
  moduleId,
  activeRun,
  runStateLoading,
  refreshRunState,
}: SerialRunActionProps) {
  const eligible = useSubtreeRunEligibility(task, moduleId);
  const serial = useSubtreeRunLaunch({
    item: task,
    mode: "serial",
    actionName: "Run subtree serially",
    successMessage: "Serial subtree run started.",
    inertMessage:
      "Serial subtree run started nothing: every remaining work item is finished, blocked, or already running.",
    failureMessage: "Serial subtree execution could not be started",
    refreshRunState,
  });
  const shortcut = useGlobalShortcutLabel("normal-run-command");
  const isBranch = task.sub_issues_count > 0;
  const ownsShortcut = useSubtreeNormalRunCommand({
    mode: "serial",
    taskId: task.id,
    armed: isBranch && eligible && !activeRun && !runStateLoading,
    launch: serial.launch,
  });

  if (!isBranch) return null;
  if (runStateLoading || activeRun) return null;

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
      shortcut={eligible && ownsShortcut ? shortcut : null}
    />
  );
}
