import { createApolloStore } from "../../../../shared/apollo/localState";
import { TEMP_TASK_ID } from "../../types";
import { scratchBucketId } from "../../terminal";
import { getModuleTreeSnapshot } from "../../../work-items";
import { useClientStore } from "../../../../state/clientStore";
import type {
  EditViewZone,
  FocusedPane,
  WorkspaceSelection,
} from "../../../../state/clientStore";

interface ChangesWorkspaceOrigin {
  selectedModuleId: string | null;
  selectedTaskId: string | null;
  workspaceSelection: WorkspaceSelection;
  focusedPane: FocusedPane;
  editViewZone: EditViewZone;
  editViewBodyEngaged: boolean;
  sidebarVisible: boolean;
  panelLayout: number[] | null;
}

interface ChangesWorkspaceState {
  active: boolean;
  moduleId: string | null;
  taskId: string | null;
  origin: ChangesWorkspaceOrigin | null;
  taskIdByModule: Record<string, string | null>;
}

export const useChangesWorkspace = createApolloStore<ChangesWorkspaceState>(
  "changes-workspace",
  () => ({
    active: false,
    moduleId: null,
    taskId: null,
    origin: null,
    taskIdByModule: {},
  }),
);

function planningOrigin(): ChangesWorkspaceOrigin {
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

export function selectChangesCheckout(
  moduleId: string,
  taskId: string | null,
): void {
  useChangesWorkspace.setState((state) => ({
    moduleId,
    taskId,
    taskIdByModule: { ...state.taskIdByModule, [moduleId]: taskId },
  }));
}

export function openChangesWorkspace(
  moduleId: string,
  taskId: string | null,
): void {
  useChangesWorkspace.setState((state) => ({
    active: true,
    moduleId,
    taskId,
    origin: state.active ? state.origin : planningOrigin(),
    taskIdByModule: { ...state.taskIdByModule, [moduleId]: taskId },
  }));
}

export function openModuleChangesWorkspace(moduleId: string): void {
  openChangesWorkspace(moduleId, null);
}

export function openTaskChangesWorkspace(
  moduleId: string,
  taskId: string,
): void {
  openChangesWorkspace(moduleId, taskId);
}

export function leaveChangesWorkspace(): void {
  const { origin } = useChangesWorkspace.getState();
  useChangesWorkspace.setState({
    active: false,
    moduleId: null,
    taskId: null,
    origin: null,
  });
  if (!origin) return;
  const originTaskStillExists =
    !origin.selectedTaskId ||
    origin.selectedTaskId === TEMP_TASK_ID ||
    getModuleTreeSnapshot(null, origin.selectedModuleId).order.includes(
      origin.selectedTaskId,
    );
  const selectedTaskId = originTaskStillExists
    ? origin.selectedTaskId
    : TEMP_TASK_ID;
  useClientStore.setState({ ...origin, selectedTaskId });
  if (!originTaskStillExists && origin.selectedModuleId) {
    const client = useClientStore.getState();
    const scratchBucket = scratchBucketId(origin.selectedModuleId);
    client.ensureWorkspace(scratchBucket);
    client.setActive(scratchBucket, "details");
  }
}

/** Ends review after explicit global navigation without returning to its origin. */
export function dismissChangesWorkspace(): void {
  useChangesWorkspace.setState({
    active: false,
    moduleId: null,
    taskId: null,
    origin: null,
  });
}
