import { useCallback, useEffect, useRef, useState } from "react";
import {
  launchDefaultAgent,
  launchFailureMessage,
} from "../../../../../features/agents/terminal";
import { requireModuleFolderForLaunch } from "../../../../../features/studio/modals/PlanFeature";
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
} from "../../../../../features/work-items";
import type { WorkItem } from "../../../../../shared/api/types";
import { IconPlay } from "../../../../../shared/ui/icons";
import { KeyBadge } from "../../../../../shared/ui/KeyChordHint";
import { useGlobalShortcutLabel } from "../../../../navigation/useGlobalShortcutLabel";
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
  const shortcut = useGlobalShortcutLabel("normal-run-command");
  const branch = useSubtreeRunLaunch({
    item: task,
    moduleId,
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
          className="h-7 border border-pane-border px-2.5 text-sm text-text-muted hover:border-focus-accent hover:text-text-primary"
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
        shortcut={subtreeEligible ? shortcut : null}
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
  const shortcut = useGlobalShortcutLabel("normal-run-command");
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
  const requestRun = useCallback(
    () => requireModuleFolderForLaunch(moduleId, () => void runLeaf()),
    [moduleId, runLeaf],
  );

  useEffect(() => {
    if (!registerShortcut) return;
    return registerNormalRunCommand(task.id, requestRun);
  }, [registerShortcut, requestRun, task.id]);

  return (
    <button
      type="button"
      aria-label="Run item"
      aria-busy={pending}
      title="Run item"
      disabled={pending}
      onClick={requestRun}
      className="inline-flex h-7 flex-none items-center gap-2 border border-focus-accent px-2.5 text-sm text-text-primary hover:bg-pane-title disabled:cursor-wait disabled:opacity-60"
    >
      <IconPlay size={14} />
      Run
      {registerShortcut && shortcut ? <KeyBadge>{shortcut}</KeyBadge> : null}
    </button>
  );
}
