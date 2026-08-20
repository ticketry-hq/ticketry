import { useModalStore } from "../../modal/modalStore";
import { startInstantChangeFlow } from "../../../features/studio/modals/PlanFeature";
import {
  foregroundKey,
  useTerminalForegroundStore,
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../../../features/agents/terminal/appNavigation";
import { useAgentStatusStore } from "../../../features/agents/status";
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
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import type { WorkItem } from "../../../shared/api/types";
import { getModuleTreeSnapshot } from "../../../features/work-items/queries";
import { getStatesSnapshot } from "../../../shared/query/stateCatalog";
import { useStudioStore } from "../../../features/projects/store";
import {
  selectLiveTerminalStops,
  selectLiveTerminalStop,
  type LiveTerminalCycleDirection,
} from "../../../features/studio/lib/liveTerminalCycle";
import {
  selectModuleTaskOrder,
  taskRevealPath,
  type TreeWorkItem,
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
import {
  activateSelectedWorkItem,
} from "../workItemActivation";

const FOCUSED_PANE_ACTIONS: Record<FocusedPane, ReadonlySet<string>> = {
  projects: new Set(["projects.next", "projects.previous", "projects.activate"]),
  modules: new Set(["modules.next", "modules.previous", "modules.activate"]),
  tasks: new Set([
    "tasks.next",
    "tasks.previous",
    "tasks.activate",
    "tasks.choose-provider",
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
  taskRows: TreeRow[],
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
  taskRows: TreeRow[],
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
  taskRows: TreeRow[],
  direction: LiveTerminalCycleDirection,
): void {
  consume(event);

  const projectId = useStudioStore.getState().selectedProjectId;
  const ui = useClientStore.getState();
  const tree = getModuleTreeSnapshot(projectId, ui.selectedModuleId);
  const itemsById = Object.fromEntries(tree.order.flatMap((id) => {
    const item = queryClient.getQueryData<WorkItem>(queryKeys.workItems.byId(id));
    return item ? [[id, item] as const] : [];
  })) as unknown as Record<string, TreeWorkItem>;
  const terminal = useTerminalStore.getState();
  const tabs = useWorkspaceTabsStore.getState();
  const workspace = useTicketWorkspaceStore.getState();
  const stops = selectLiveTerminalStops({
    moduleId: ui.selectedModuleId,
    taskRows,
    taskOrder: ui.storySearchQuery.trim()
      ? undefined
      : selectModuleTaskOrder(tree, itemsById, getStatesSnapshot(projectId)),
    agentStatus: useAgentStatusStore.getState(),
    sessions: terminal.sessions,
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

function routeProjectsPane(
  { event, tasks, ui }: NavigationContext,
  actionId: string | null,
): boolean {
  const orderedIds = tasks.projects.map((project) => project.id);
  const cursorId = resolveCursorId(ui.projectsCursorId, orderedIds);

  if (actionId === "projects.next" || actionId === "projects.previous") {
    consume(event);
    ui.moveProjectsCursor(
      actionId === "projects.next" ? 1 : -1,
      orderedIds,
    );
    return true;
  }

  if (actionId !== "projects.activate") return false;

  consume(event);
  const project = tasks.projects.find((candidate) => candidate.id === cursorId);
  if (project) void tasks.selectProject(project.id);
  return true;
}

function routeModulesPane(
  { event, tasks, ui }: NavigationContext,
  actionId: string | null,
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
      return activateTask(ctx);
    case "tasks.choose-provider":
      return chooseTaskProvider(ctx);
    case "tasks.expand":
      return expandOrEnterTask(ctx);
    case "tasks.collapse":
      return collapseOrLeaveTask(ctx);
    default:
      return false;
  }
}

function activateTask(ctx: NavigationContext): boolean {
  const row = currentTaskRow(ctx);
  if (!row) {
    consume(ctx.event);
    return true;
  }
  const { selectedProjectId, selectedModuleId } = ctx.tasks;
  if (
    selectedProjectId &&
    selectedModuleId &&
    ctx.tasks.itemsById[row.id] &&
    activateSelectedWorkItem(
      {
        projectId: selectedProjectId,
        moduleId: selectedModuleId,
        taskId: row.id,
      },
      "open-default-terminal",
    )
  ) {
    consume(ctx.event);
    return true;
  }
  return openAgentPicker(ctx);
}

function chooseTaskProvider(ctx: NavigationContext): boolean {
  consume(ctx.event);
  const row = currentTaskRow(ctx);
  const { selectedProjectId, selectedModuleId } = ctx.tasks;
  if (
    row &&
    selectedProjectId &&
    selectedModuleId &&
    ctx.tasks.itemsById[row.id]
  ) {
    activateSelectedWorkItem(
      {
        projectId: selectedProjectId,
        moduleId: selectedModuleId,
        taskId: row.id,
      },
      "choose-provider",
    );
  }
  return true;
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

  useModalStore.getState().pushModal({
    type: "agent-picker",
    payload: { mode: "open", ...launchContext },
  });
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
