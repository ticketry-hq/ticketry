import { useCallback, useEffect, useRef, useState } from "react";
import { launchFailureMessage } from "../../../../../features/agents/terminal";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import {
  refreshSubtreeRunCapabilities,
  useLaunchBindingStatesQuery,
} from "../../../../../features/settings";
import {
  registerNormalRunCommand,
  runWorkItem,
  startNormalRun,
} from "../../../../../features/work-items";
import {
  watchNewTaskRunTab,
  type NewTaskRunTabWatch,
} from "../../../../../features/work-items/taskRunTabActivation";
import type { WorkItem } from "../../../../../shared/api/types";
import { IconPlay } from "../../../../../shared/ui/icons";
import { toast } from "../../../../../state/clientStore";
import { SubtreeRunButton } from "./internal/SubtreeRunButton";
import { useSubtreeRunEligibility, useSubtreeRunLaunch } from "./internal/subtreeRun";

export function NormalRunAction({
  task,
  moduleId,
}: {
  task: WorkItem;
  moduleId: string | null;
}) {
  const isBranch = task.sub_issues_count > 0;
  const subtreeEligible = useSubtreeRunEligibility(task, moduleId);
  const { data: launchBindingStates } = useLaunchBindingStatesQuery(
    task.project_id,
  );
  const leafEligible =
    task.id !== TEMP_TASK_ID &&
    moduleId !== null &&
    task.state !== null &&
    launchBindingStates?.[task.issue_type]?.includes(task.state) === true;
  const branch = useSubtreeRunLaunch({
    item: task,
    actionName: "Run subtree",
    successMessage: "Subtree run started.",
    inertMessage:
      "Subtree run started nothing: every remaining work item is finished, blocked, or already running.",
    failureMessage: "Subtree execution could not be started",
    execute: async () => {
      const result = await runWorkItem(
        task,
        moduleId ? { projectId: task.project_id, moduleId } : undefined,
      );
      return { launched: result.kind === "subtree" ? result.launched : [] };
    },
  });

  useEffect(() => {
    if (!isBranch || !subtreeEligible) return;
    return registerNormalRunCommand(task.id, branch.launch);
  }, [branch.launch, isBranch, subtreeEligible, task.id]);

  if (task.id === TEMP_TASK_ID) return null;
  if (isBranch) {
    const unavailableReason = subtreeEligible
      ? undefined
      : "Subtree execution is not available in this item's current state.";
    return (
      <SubtreeRunButton
        name="Run subtree"
        pending={branch.pending}
        pendingLabel="Running…"
        onClick={() => startNormalRun(task.id)}
        disabled={!subtreeEligible}
        unavailableReason={unavailableReason}
      />
    );
  }
  if (!leafEligible) return null;

  return <RunItemAction task={task} moduleId={moduleId} />;
}

export function RunItemAction({
  task,
  moduleId,
}: {
  task: WorkItem;
  moduleId: string | null;
}) {
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);
  const runTabWatchRef = useRef<NewTaskRunTabWatch | null>(null);

  useEffect(() => () => {
    runTabWatchRef.current?.cancel();
    runTabWatchRef.current = null;
  }, [task.id]);

  const runLeaf = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPending(true);
    runTabWatchRef.current?.cancel();
    const runTabWatch = moduleId
      ? watchNewTaskRunTab({
          taskId: task.id,
          projectId: task.project_id,
          moduleId,
        })
      : null;
    runTabWatchRef.current = runTabWatch;
    try {
      await runWorkItem(
        task,
        moduleId ? { projectId: task.project_id, moduleId } : undefined,
      );
      runTabWatch?.acknowledge();
      toast.success("Agent run started.");
    } catch (error) {
      runTabWatch?.cancel();
      if (runTabWatchRef.current === runTabWatch) runTabWatchRef.current = null;
      await refreshSubtreeRunCapabilities(task.project_id);
      toast.error(`Agent run could not be started: ${launchFailureMessage(error)}`);
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [moduleId, task]);

  useEffect(
    () => registerNormalRunCommand(task.id, () => void runLeaf()),
    [runLeaf, task.id],
  );

  return (
    <button
      type="button"
      aria-label="Run item"
      aria-busy={pending}
      title="Run item"
      disabled={pending}
      onClick={() => startNormalRun(task.id)}
      className="flex-none border border-pane-border p-1.5 text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      <IconPlay size={14} />
    </button>
  );
}
