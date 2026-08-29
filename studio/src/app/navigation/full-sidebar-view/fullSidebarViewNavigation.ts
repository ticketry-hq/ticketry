import { useModalStore } from "../../modal/modalStore";
import { startInstantChangeFlow } from "../../../features/studio/modals/PlanFeature";
import {
  foregroundKey,
  useTerminalForegroundStore,
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../../../features/agents/terminal/appNavigation";
import { readAgentStatusHolding } from "../../../features/agents/status";
import {
  type FocusedPane,
  resolveCursorId,
  useClientStore,
} from "../../../state/clientStore";
import {
  routeTaskWorkspaceTabAction,
  useTicketWorkspaceStore,
} from "../../shell/ticket-workspace/selected-ticket/appNavigation";
import type { TreeRow } from "../../shell/ticket-workspace/tasks/TasksPane";
import { getModuleTreeSnapshot, getWorkItemSnapshot } from "../../../features/work-items";
import { getStatesSnapshot } from "../../../features/projects";
import { useStudioStore } from "../../../features/projects";
import {
  selectLiveTerminalStops,
  selectLiveTerminalStop,
  type LiveTerminalCycleDirection,
} from "../../../features/studio/lib/liveTerminalCycle";
import { loadWorkspaceTabOrder } from "../../../features/workspace-tabs/queries";
import {
  selectModuleTaskOrder,
  taskRevealPath,
  type TreeWorkItem,
} from "../../../features/work-items";
import {
  consume,
  createNavigationContext,
  currentTaskRow,
  moveTaskSelection,
  type NavigationContext,
  selectedTaskIndex,
  selectTaskAt,
} from "../navigationContext";

const FOCUSED_PANE_ACTIONS: Record<FocusedPane, ReadonlySet<string>> = {
  modules: new Set(["modules.next", "modules.previous", "modules.activate"]),
  tasks: new Set([
    "tasks.next",
    "tasks.previous",
    "tasks.activate",
    "tasks.expand",
    "tasks.collapse",
  ]),
  "details-or-terminal": new Set(),
};

let liveTerminalCycleQueue = Promise.resolve();

export function focusedPaneActionIds(pane: FocusedPane): ReadonlySet<string> {
  return FOCUSED_PANE_ACTIONS[pane];
}

/** Routes capture-phase shortcuts that only exist in the full sidebar view. */
export function routeFullSidebarViewCaptureNavigation(
  event: KeyboardEvent,
  taskRows: TreeRow[],
  actionId: string | null,
): boolean {
  if (actionId === "cycle-terminal-forward") {
    queueLiveTerminalCycle(event, taskRows, "forward");
    return true;
  }
  if (actionId === "cycle-terminal-backward") {
    queueLiveTerminalCycle(event, taskRows, "backward");
    return true;
  }
  if (
    actionId === "workspace-tab-next" ||
    actionId === "workspace-tab-previous"
  ) {
    routeTaskWorkspaceTabAction(event, actionId);
    return true;
  }
  return false;
}

export function routeFullSidebarViewFocusedPaneNavigation(
  event: KeyboardEvent,
  taskRows: TreeRow[],
  actionId: string | null,
  selectSidebarModule: (moduleId: string) => void,
): boolean {
  const ctx = createNavigationContext(event, taskRows);
  switch (ctx.ui.focusedPane) {
    case "modules":
      return routeModulesPane(ctx, actionId, selectSidebarModule);
    case "tasks":
      return routeTasksPane(ctx, actionId);
    case "details-or-terminal":
      return false;
  }
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

function routeModulesPane(
  { event, tasks, ui }: NavigationContext,
  actionId: string | null,
  selectSidebarModule: (moduleId: string) => void,
): boolean {
  if (actionId === "modules.next" || actionId === "modules.previous") {
    consume(event);
    ui.moveModulesCursor(
      actionId === "modules.next" ? 1 : -1,
      tasks.modules.map((module) => module.id),
    );
    return true;
  }

  if (actionId !== "modules.activate") return false;

  const moduleId = resolveCursorId(
    ui.modulesCursorId,
    tasks.modules.map((candidate) => candidate.id),
  );
  const module = tasks.modules.find((candidate) => candidate.id === moduleId);
  if (event.shiftKey && module) {
    consume(event);
    selectSidebarModule(module.id);
    startInstantChangeFlow();
    return true;
  }

  consume(event);
  if (module) selectSidebarModule(module.id);
  return true;
}

function routeTasksPane(
  ctx: NavigationContext,
  actionId: string | null,
): boolean {
  switch (actionId) {
    case "tasks.next":
      return moveTaskSelection(ctx, 1);
    case "tasks.previous":
      return moveTaskSelection(ctx, -1);
    case "tasks.activate":
      return openAgentPicker(ctx);
    case "tasks.expand":
      return expandOrEnterTask(ctx);
    case "tasks.collapse":
      return collapseOrLeaveTask(ctx);
    default:
      return false;
  }
}

function openAgentPicker(ctx: NavigationContext): boolean {
  consume(ctx.event);
  const selected = selectedTaskIndex(ctx.taskRows, ctx.tasks.selectedTaskId);
  const row = ctx.taskRows[selected];
  if (!row || row.kind !== "work-item") return true;

  const { selectedProjectId, selectedModuleId } = ctx.tasks;
  if (!selectedProjectId || !selectedModuleId) return true;
  const task = ctx.tasks.itemsById[row.id];
  if (!task) return true;
  const launchContext = {
    projectId: selectedProjectId,
    moduleId: selectedModuleId,
    taskId: row.id,
  };

  if (ctx.event.shiftKey) {
    useModalStore.getState().pushModal({
      type: "prompt-input",
      payload: {
        next: "agent-picker",
        nextPayload: { mode: "open-with-prompt", ...launchContext },
      },
    });
  } else {
    useModalStore.getState().pushModal({
      type: "agent-picker",
      payload: { mode: "open", ...launchContext },
    });
  }
  return true;
}

function expandOrEnterTask(ctx: NavigationContext): boolean {
  const row = currentTaskRow(ctx);
  if (!row) return false;

  if (row.expandable && !row.expanded) {
    consume(ctx.event);
    const moduleId = ctx.tasks.selectedModuleId;
    if (moduleId) ctx.ui.setExpanded(moduleId, row.id, true);
    return true;
  }
  if (row.expandable && row.expanded) {
    consume(ctx.event);
    const selected = selectedTaskIndex(ctx.taskRows, ctx.tasks.selectedTaskId);
    selectTaskAt(ctx.taskRows, selected + 1);
    return true;
  }
  return false;
}

function collapseOrLeaveTask(ctx: NavigationContext): boolean {
  const row = currentTaskRow(ctx);
  if (!row) return false;

  if (row.expandable && row.expanded) {
    consume(ctx.event);
    const moduleId = ctx.tasks.selectedModuleId;
    if (moduleId) ctx.ui.toggleExpanded(moduleId, row.id);
    return true;
  }
  if (!row.parentId) return false;

  consume(ctx.event);
  const parentIndex = ctx.taskRows.findIndex(
    (candidate) =>
      candidate.kind === "work-item" && candidate.id === row.parentId,
  );
  if (parentIndex >= 0) selectTaskAt(ctx.taskRows, parentIndex);
  return true;
}
