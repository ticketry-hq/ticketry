import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import { scratchBucketId } from "../../../../../features/agents/terminal";
import { createApolloStore } from "../../../../../shared/apollo/localState";
import { useClientStore } from "../../../../../state/clientStore";
import { rememberStudioWorkspaceTarget } from "../../../../../features/workspace-state/studioWorkspaceTarget";

type ChangesCheckoutSelection = {
  taskIdByModule: Record<string, string | null>;
};

export const useChangesCheckoutSelection = createApolloStore<ChangesCheckoutSelection>(
  "changes-checkout-selection",
  () => ({ taskIdByModule: {} }),
);

export function selectChangesCheckout(moduleId: string, taskId: string | null): void {
  useChangesCheckoutSelection.setState((state) => ({
    taskIdByModule: { ...state.taskIdByModule, [moduleId]: taskId },
  }));
}

export function clearChangesCheckout(moduleId: string): void {
  useChangesCheckoutSelection.setState((state) => {
    const taskIdByModule = { ...state.taskIdByModule };
    delete taskIdByModule[moduleId];
    return { taskIdByModule };
  });
}

function openChangesWorkspace(moduleId: string, taskId: string | null): void {
  const client = useClientStore.getState();
  const planningTaskId = client.selectedTaskId;
  const bucket = planningTaskId && planningTaskId !== TEMP_TASK_ID
    ? planningTaskId
    : scratchBucketId(moduleId);
  selectChangesCheckout(moduleId, taskId);
  client.selectTask(planningTaskId ?? TEMP_TASK_ID);
  client.ensureWorkspace(bucket);
  client.setActive(bucket, "changes");
  rememberStudioWorkspaceTarget(bucket, { kind: "changes" });
}

export function openModuleChangesWorkspace(moduleId: string): void {
  openChangesWorkspace(moduleId, null);
}

export function openTaskChangesWorkspace(moduleId: string, taskId: string): void {
  openChangesWorkspace(moduleId, taskId);
}
