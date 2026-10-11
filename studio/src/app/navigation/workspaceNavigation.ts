import { foregroundKey, useTerminalForegroundStore, useTerminalStore, useWorkspaceTabsStore } from "../../features/agents/terminal/appNavigation";
import { readAgentStatusHolding } from "../../features/agents/status";
import { useClientStore } from "../../state/clientStore";
import { routeTaskWorkspaceTabAction, useTicketWorkspaceStore } from "../shell/ticket-workspace/selected-ticket/appNavigation";
import type { TreeRow } from "../shell/ticket-workspace/tasks/TasksPane";
import { getModuleTreeSnapshot, getWorkItemSnapshot, selectModuleTaskOrder, taskRevealPath, type TreeWorkItem } from "../../features/work-items";
import { getStatesSnapshot, useStudioStore } from "../../features/projects";
import { selectLiveTerminalStops, selectLiveTerminalStop, type LiveTerminalCycleDirection } from "../../features/studio/lib/liveTerminalCycle";
import { loadWorkspaceTabOrder } from "../../features/workspace-tabs/queries";
import { consume } from "./navigationContext";

let liveTerminalCycleQueue = Promise.resolve();

/** Routes workspace capture shortcuts before local navigation zones. */
export function routeWorkspaceCaptureNavigation(event: KeyboardEvent, taskRows: TreeRow[], actionId: string | null): boolean {
  if (actionId === "cycle-terminal-forward" || actionId === "cycle-terminal-backward") {
    queueLiveTerminalCycle(event, taskRows, actionId === "cycle-terminal-forward" ? "forward" : "backward");
    return true;
  }
  if (actionId === "workspace-tab-next" || actionId === "workspace-tab-previous") {
    routeTaskWorkspaceTabAction(event, actionId);
    return true;
  }
  return false;
}

function queueLiveTerminalCycle(
  event: KeyboardEvent,
  taskRows: TreeRow[],
  direction: LiveTerminalCycleDirection,
): void {
  consume(event);
  const runCycle = () => cycleLiveTerminal(taskRows, direction);
  liveTerminalCycleQueue = liveTerminalCycleQueue.then(runCycle, runCycle);
}

async function cycleLiveTerminal(
  taskRows: TreeRow[],
  direction: LiveTerminalCycleDirection,
): Promise<void> {
  const projectId = useStudioStore.getState().selectedProjectId;
  const ui = useClientStore.getState();
  const tree = getModuleTreeSnapshot(projectId, ui.selectedModuleId);
  const itemsById = Object.fromEntries(tree.order.flatMap((id) => {
    const item = getWorkItemSnapshot(id);
    return item ? [[id, item] as const] : [];
  })) as unknown as Record<string, TreeWorkItem>;
  const terminal = useTerminalStore.getState();
  const tabs = useWorkspaceTabsStore.getState();
  const workspace = useTicketWorkspaceStore.getState();
  const taskIds = ui.storySearchQuery.trim()
    ? undefined
    : selectModuleTaskOrder(tree, itemsById, getStatesSnapshot(projectId));
  const candidateStops = selectLiveTerminalStops({
    moduleId: ui.selectedModuleId,
    taskRows,
    taskOrder: taskIds,
    agentStatus: readAgentStatusHolding(),
    sessions: terminal.sessions,
  });
  const orderedTaskIds = Array.from(new Set(
    candidateStops.map((stop) => stop.taskId),
  ));
  let terminalOrderByTask: Record<string, readonly string[]>;
  try {
    terminalOrderByTask = Object.fromEntries(await Promise.all(
      orderedTaskIds.map(async (taskId) => {
        const saved = await loadWorkspaceTabOrder(taskId);
        return [
          taskId,
          saved.order.flatMap((identity) =>
            identity.kind === "terminal" ? [identity.id] : [],
          ),
        ] as const;
      }),
    ));
  } catch {
    // An unknown saved order can disagree with the visible strip. Stay put
    // until every work item that contributes a stop has loaded.
    return;
  }
  const stops = selectLiveTerminalStops({
    moduleId: ui.selectedModuleId,
    taskRows,
    taskOrder: taskIds,
    agentStatus: readAgentStatusHolding(),
    sessions: terminal.sessions,
    terminalOrderByTask,
  });
  const currentSessionId = ui.selectedTaskId
    ? tabs.activeByTask[ui.selectedTaskId] ?? null
    : null;
  const next = selectLiveTerminalStop(stops, currentSessionId, direction);
  if (!next) return;

  const session = terminal.sessions[next.sessionId];
  if (!session) return;

  const moduleId = ui.selectedModuleId;
  if (moduleId) {
    const reveal = taskRevealPath(
      next.taskId,
      tree,
      itemsById,
      getStatesSnapshot(projectId),
    );
    if (reveal.stateId && ui.collapsedStateIds.has(reveal.stateId)) {
      ui.toggleStateCollapsed(reveal.stateId);
    }
  }

  useClientStore.setState({
    selectedTaskId: next.taskId,
    workspaceSelection: { kind: "task" },
  });
  workspace.setActive(next.taskId, "terminal");
  useTerminalForegroundStore
    .getState()
    .acquire(foregroundKey(session), "studio");
  terminal.focusSession(next.sessionId);
  useClientStore.setState({ focusedPane: "details-or-terminal" });
}

