import { createApolloStore } from "../../shared/apollo/localState";
import { studioApolloClient } from "../../shared/apollo/client";
import { useClientStore, toast, type ClientState } from "../../state/clientStore";
import { scratchBucketId, TEMP_TASK_ID } from "../agents/terminal";
import { getModuleTreeSnapshot, loadModuleTree, readWorkItem } from "../work-items";
import { getVisibleModulesSnapshot, useStudioStore } from "../projects";
import { adaptPlanningGraph, PlanningGraphDocument } from "../planning-graph";

type PlanOrigin = Pick<ClientState,
  | "selectedModuleId"
  | "selectedTaskId"
  | "workspaceSelection"
  | "focusedPane"
  | "editViewZone"
  | "editViewBodyEngaged"
  | "sidebarVisible"
  | "panelLayout"
>;

export interface PlanVisit {
  epicTabs: string[];
  activeEpicId: string | null;
}

interface PlanWorkspaceState {
  active: boolean;
  generation: number;
  itemRequestVersion: number;
  projectId: string | null;
  defaultSprintPending: boolean;
  sprintId: string | null;
  lastVisitedSprintId: string | null;
  visits: Record<string, PlanVisit>;
  openItem: string | null;
  pendingOpenItem: string | null;
  origin: PlanOrigin | null;
}

export const usePlanWorkspace = createApolloStore<PlanWorkspaceState>(
  "plan-workspace",
  () => ({ active: false, generation: 0, itemRequestVersion: 0, projectId: null, defaultSprintPending: false, sprintId: null, lastVisitedSprintId: null, visits: {}, openItem: null, pendingOpenItem: null, origin: null }),
);

function planningGraph() {
  const projectId = useStudioStore.getState().selectedProjectId;
  if (!projectId) return null;
  const data = studioApolloClient().readQuery({
    query: PlanningGraphDocument,
    variables: { projectId },
    optimistic: true,
  });
  return data ? adaptPlanningGraph(data) : null;
}

function planningOrigin(): PlanOrigin {
  const state = useClientStore.getState();
  return {
    selectedModuleId: state.selectedModuleId,
    selectedTaskId: state.selectedTaskId,
    workspaceSelection: state.workspaceSelection,
    focusedPane: state.focusedPane,
    editViewZone: state.editViewZone,
    editViewBodyEngaged: state.editViewBodyEngaged,
    sidebarVisible: state.sidebarVisible,
    panelLayout: state.panelLayout,
  };
}

export function openPlanWorkspace(sprintId?: string | null): void {
  const projectId = useStudioStore.getState().selectedProjectId;
  const graph = planningGraph();
  const nextSprintId = sprintId ?? graph?.sprints
    .filter((sprint) => sprint.status === "planned")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]?.id ?? null;
  usePlanWorkspace.setState((state) => {
    const sameProject = state.projectId === projectId;
    return {
      active: true,
      generation: state.generation + 1,
      projectId,
      defaultSprintPending: !sprintId && !graph,
      sprintId: nextSprintId,
      lastVisitedSprintId: sameProject && !nextSprintId ? state.lastVisitedSprintId : nextSprintId,
      visits: state.visits,
      openItem: null,
      pendingOpenItem: null,
      origin: state.active && sameProject ? state.origin : planningOrigin(),
    };
  });
}

export function openPlanSprint(sprintId: string): void {
  openPlanWorkspace(sprintId);
}

export function closePlanSprint(): void {
  usePlanWorkspace.setState((state) => ({ generation: state.generation + 1, sprintId: null, openItem: null, pendingOpenItem: null, defaultSprintPending: false }));
}

export async function openPlanItem(workItemId: string, suggestionId?: string): Promise<void> {
  const graph = planningGraph();
  const item = graph?.workItems.find((candidate) => candidate.id === workItemId);
  const currentWorkspace = usePlanWorkspace.getState();
  if (!item || !currentWorkspace.active || currentWorkspace.projectId !== useStudioStore.getState().selectedProjectId) return;
  const projectId = useStudioStore.getState().selectedProjectId;
  const moduleId = item.moduleId ?? getVisibleModulesSnapshot(projectId)[0]?.id ?? null;
  const openItem = suggestionId ? `suggestion:${suggestionId}` : workItemId;
  const generation = currentWorkspace.generation;
  const requestVersion = currentWorkspace.itemRequestVersion + 1;
  usePlanWorkspace.setState({ pendingOpenItem: openItem, itemRequestVersion: requestVersion });
  try {
    if (projectId && moduleId) await loadModuleTree(projectId, moduleId);
    if (!item.moduleId) await readWorkItem(workItemId);
  } catch (error) {
    const state = usePlanWorkspace.getState();
    if (state.active && state.generation === generation && state.itemRequestVersion === requestVersion &&
      state.pendingOpenItem === openItem && useStudioStore.getState().selectedProjectId === projectId) {
      usePlanWorkspace.setState({ pendingOpenItem: null });
      toast.error(error instanceof Error ? error.message : "Could not open this story.");
    }
    return;
  }
  const workspace = usePlanWorkspace.getState();
  if (!workspace.active || workspace.generation !== generation || workspace.itemRequestVersion !== requestVersion ||
    workspace.pendingOpenItem !== openItem ||
    useStudioStore.getState().selectedProjectId !== projectId) return;
  useClientStore.setState({
    selectedModuleId: moduleId,
    selectedTaskId: workItemId,
    workspaceSelection: { kind: "task" },
  });
  usePlanWorkspace.setState({ openItem, pendingOpenItem: null });
}

export function leavePlanWorkspace(): void {
  const { origin, projectId } = usePlanWorkspace.getState();
  usePlanWorkspace.setState((state) => ({ generation: state.generation + 1, active: false, sprintId: null, openItem: null, pendingOpenItem: null, origin: null, defaultSprintPending: false }));
  if (!origin || projectId !== useStudioStore.getState().selectedProjectId) return;
  const taskExists = !origin.selectedTaskId || origin.selectedTaskId === TEMP_TASK_ID ||
    getModuleTreeSnapshot(null, origin.selectedModuleId).order.includes(origin.selectedTaskId);
  const selectedTaskId = taskExists ? origin.selectedTaskId : TEMP_TASK_ID;
  useClientStore.setState({ ...origin, selectedTaskId });
  if (!taskExists && origin.selectedModuleId) {
    const client = useClientStore.getState();
    const scratchBucket = scratchBucketId(origin.selectedModuleId);
    client.ensureWorkspace(scratchBucket);
    client.setActive(scratchBucket, "details");
  }
}

export function setPlanVisit(sprintId: string, visit: PlanVisit): void {
  usePlanWorkspace.setState((state) => ({ visits: { ...state.visits, [sprintId]: visit } }));
}

export function inheritLastPlanVisit(projectId: string, sprintId: string): void {
  usePlanWorkspace.setState((state) => {
    const previous = state.projectId === projectId && state.lastVisitedSprintId
      ? state.visits[state.lastVisitedSprintId] : undefined;
    return { visits: { ...state.visits, [sprintId]: previous
      ? { epicTabs: [...previous.epicTabs], activeEpicId: previous.activeEpicId }
      : { epicTabs: [], activeEpicId: null } } };
  });
}
