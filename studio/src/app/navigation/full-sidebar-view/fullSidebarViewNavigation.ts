import { useModalStore } from "../../modal/modalStore";
import { startInstantChangeFlow } from "../../../features/studio/modals/PlanFeature";
import { useTasksStore } from "../../../features/studio/stores/tasksStore";
import {
  foregroundKey,
  useTerminalForegroundStore,
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../../../features/agents/terminal/appNavigation";
import { useAgentStatusStore } from "../../../features/agents/status";
import { TEMP_TASK_ID } from "../../../features/agents/types";
import {
  type FocusedPane,
  useUIStore,
} from "../../../features/studio/stores/uiStore";
import {
  routeTaskWorkspaceTabAction,
  useIssueDrawerWorkspaceStore,
} from "../../../features/work-items/issue-detail/appNavigation";
import type { Row } from "../../../features/studio/pages/tasks/TasksPane";
import {
  selectLiveTerminalStops,
  selectLiveTerminalStop,
  type LiveTerminalCycleDirection,
} from "../../../features/studio/lib/liveTerminalCycle";
import {
  selectModuleTaskOrder,
  taskRevealPath,
} from "../../../features/studio/lib/taskTree";
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
  projects: new Set(["projects.next", "projects.previous", "projects.activate"]),
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

export function focusedPaneActionIds(pane: FocusedPane): ReadonlySet<string> {
  return FOCUSED_PANE_ACTIONS[pane];
}

/** Routes capture-phase shortcuts that only exist in the full sidebar view. */
export function routeFullSidebarViewCaptureNavigation(
  event: KeyboardEvent,
  taskRows: Row[],
  actionId: string | null,
): boolean {
  if (actionId === "cycle-terminal-forward") {
    cycleLiveTerminal(event, taskRows, "forward");
    return true;
  }
  if (actionId === "cycle-terminal-backward") {
    cycleLiveTerminal(event, taskRows, "backward");
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
  taskRows: Row[],
  actionId: string | null,
): boolean {
  const ctx = createNavigationContext(event, taskRows);
  switch (ctx.ui.focusedPane) {
    case "projects":
      return routeProjectsPane(ctx, actionId);
    case "modules":
      return routeModulesPane(ctx, actionId);
    case "tasks":
      return routeTasksPane(ctx, actionId);
    case "details-or-terminal":
      return false;
  }
}

function cycleLiveTerminal(
  event: KeyboardEvent,
  taskRows: Row[],
  direction: LiveTerminalCycleDirection,
): void {
  consume(event);

  const tasks = useTasksStore.getState();
  const terminal = useTerminalStore.getState();
  const tabs = useWorkspaceTabsStore.getState();
  const workspace = useIssueDrawerWorkspaceStore.getState();
  const ui = useUIStore.getState();
  const stops = selectLiveTerminalStops({
    moduleId: tasks.selectedModuleId,
    taskRows,
    taskOrder: ui.storySearchQuery.trim()
      ? undefined
      : selectModuleTaskOrder(tasks.tasks, tasks.states, tasks.subtasks),
    agentStatus: useAgentStatusStore.getState(),
    sessions: terminal.sessions,
    tabsByTask: tabs.byTaskId,
  });
  const currentSessionId = tasks.selectedTaskId
    ? tabs.activeByTask[tasks.selectedTaskId] ?? null
    : null;
  const next = selectLiveTerminalStop(stops, currentSessionId, direction);
  if (!next) return;

  const session = terminal.sessions[next.sessionId];
  if (!session) return;

  const moduleId = tasks.selectedModuleId;
  if (moduleId) {
    const reveal = taskRevealPath(
      next.taskId,
      moduleId,
      tasks.tasks,
      tasks.subtasks,
    );
    ui.expandTasks([...reveal.ancestorIds]);
    if (reveal.stateName && ui.collapsedStateNames.has(reveal.stateName)) {
      ui.toggleStateCollapsed(reveal.stateName);
    }
  }

  useTasksStore.setState({ selectedTaskId: next.taskId });
  workspace.setActive(next.taskId, "terminal");
  useTerminalForegroundStore
    .getState()
    .acquire(foregroundKey(session), "studio");
  terminal.focusSession(next.sessionId);
  useUIStore.setState({ focusedPane: "details-or-terminal" });
}

function routeProjectsPane(
  { event, tasks, ui }: NavigationContext,
  actionId: string | null,
): boolean {
  const cursor = ui.projectsCursor;

  if (actionId === "projects.next" || actionId === "projects.previous") {
    consume(event);
    const delta = actionId === "projects.next" ? 1 : -1;
    useUIStore.setState({
      projectsCursor: clampIndex(cursor + delta, tasks.projects.length),
    });
    return true;
  }

  if (actionId !== "projects.activate") return false;

  consume(event);
  const project = tasks.projects[cursor];
  if (project) void tasks.selectProject(project.id);
  return true;
}

function routeModulesPane(
  { event, tasks, ui }: NavigationContext,
  actionId: string | null,
): boolean {
  if (actionId === "modules.next" || actionId === "modules.previous") {
    consume(event);
    const delta = actionId === "modules.next" ? 1 : -1;
    useUIStore.setState({
      modulesCursor: clampIndex(ui.modulesCursor + delta, tasks.modules.length),
    });
    return true;
  }

  if (actionId !== "modules.activate") return false;

  const module = tasks.modules[ui.modulesCursor];
  if (event.shiftKey && module) {
    consume(event);
    void tasks.selectModule(module.id);
    startInstantChangeFlow();
    return true;
  }

  consume(event);
  if (module) void tasks.selectModule(module.id);
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
  if (!row || !("task" in row) || row.task.id === TEMP_TASK_ID) return true;

  const { selectedProjectId, selectedModuleId } = ctx.tasks;
  if (!selectedProjectId || !selectedModuleId) return true;
  const launchContext = {
    projectId: selectedProjectId,
    moduleId: selectedModuleId,
    taskId: row.task.id,
    ticketSeq: row.task.sequence_id,
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

  if (row.hasChildren && !row.isExpanded) {
    consume(ctx.event);
    ctx.ui.setExpanded(row.task.id, true);
    return true;
  }
  if (row.hasChildren && row.isExpanded) {
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

  if (row.hasChildren && row.isExpanded) {
    consume(ctx.event);
    ctx.ui.toggleExpanded(row.task.id);
    return true;
  }
  if (!row.parentId) return false;

  consume(ctx.event);
  const parentIndex = ctx.taskRows.findIndex(
    (candidate) => "task" in candidate && candidate.task.id === row.parentId,
  );
  if (parentIndex >= 0) selectTaskAt(ctx.taskRows, parentIndex);
  return true;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index));
}
