import { useCallback, useEffect, useRef, useState } from "react";
import {
  launchDefaultAgent,
  launchFailureMessage,
} from "../../../../../features/agents/terminal";
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
import { dispatchAgentRunAction } from "../../../../../features/agents/actions/agentRunActions";
import { LifecycleBadge } from "../../../../../features/agents/terminal";
import { AGENT_RUN_ACTIONS } from "../../../../../app/navigation/actionIds";
import type { ActiveSubtreeRun } from "../../../../../features/execution";
import { SubtreeRunButton } from "./internal/SubtreeRunButton";
import { useSubtreeRunEligibility, useSubtreeRunLaunch } from "./internal/subtreeRun";

export function NormalRunAction({
  task,
  moduleId,
}: {
  task: WorkItem;
  moduleId: string | null;
}) {
  const { data: launchBindingStates } = useLaunchBindingStatesQuery(
    task.project_id,
  );
  const eligible =
    task.id !== TEMP_TASK_ID &&
    moduleId !== null &&
    task.state !== null &&
    launchBindingStates?.[task.issue_type]?.includes(task.state) === true;

  if (!eligible) return null;

  return (
    <RunItemAction
      task={task}
      moduleId={moduleId}
      registerShortcut={task.sub_issues_count === 0}
    />
  );
}

export function SubtreeRunAction({
  task,
  moduleId,
  activeRun,
  runStateLoading,
  refreshRunState,
}: {
  task: WorkItem;
  moduleId: string | null;
  activeRun: ActiveSubtreeRun | null;
  runStateLoading: boolean;
  refreshRunState: () => Promise<void>;
}) {
  const isBranch = task.sub_issues_count > 0;
  const subtreeEligible = useSubtreeRunEligibility(task, moduleId);
  const branch = useSubtreeRunLaunch({
    item: task,
    actionName: "Run subtree",
    successMessage: "Subtree run started.",
    inertMessage:
      "Subtree run started nothing: every remaining work item is finished, blocked, or already running.",
    failureMessage: "Subtree execution could not be started",
    refreshRunState,
    execute: async () => {
      const result = await runWorkItem(
        task,
        moduleId ? { projectId: task.project_id, moduleId } : undefined,
      );
      return { launched: result.kind === "subtree" ? result.launched : [] };
    },
  });

  useEffect(() => {
    if (!isBranch || !subtreeEligible || activeRun || runStateLoading) return;
    return registerNormalRunCommand(task.id, branch.launch);
  }, [activeRun, branch.launch, isBranch, runStateLoading, subtreeEligible, task.id]);

  if (task.id === TEMP_TASK_ID) return null;
  if (runStateLoading) return null;
  if (activeRun) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <LifecycleBadge state={activeRun.state} />
        <button
          type="button"
          aria-label="Open subtree run"
          title="Open subtree run"
          onClick={() => void dispatchAgentRunAction(
            AGENT_RUN_ACTIONS.focusAgentRun,
            { runId: activeRun.runId },
          )}
          className="border border-pane-border px-2 py-1 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary"
        >
          Open
        </button>
      </span>
    );
  }
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
  return null;
}

export function RunItemAction({
  task,
  moduleId,
  registerShortcut = true,
}: {
  task: WorkItem;
  moduleId: string | null;
  registerShortcut?: boolean;
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
      await launchDefaultAgent(
        task.id,
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

  useEffect(() => {
    if (!registerShortcut) return;
    return registerNormalRunCommand(task.id, () => void runLeaf());
  }, [registerShortcut, runLeaf, task.id]);

  return (
    <button
      type="button"
      aria-label="Run item"
      aria-busy={pending}
      title="Run item"
      disabled={pending}
      onClick={() => void runLeaf()}
      className="flex-none border border-pane-border p-1.5 text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      <IconPlay size={14} />
    </button>
  );
}
