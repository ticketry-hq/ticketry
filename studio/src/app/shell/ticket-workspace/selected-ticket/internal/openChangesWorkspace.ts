import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import { scratchBucketId } from "../../../../../features/agents/terminal";
import { useClientStore } from "../../../../../state/clientStore";
import { rememberStudioWorkspaceTarget } from "./studioWorkspaceTarget";

export function openModuleChangesWorkspace(moduleId: string): void {
  const bucket = scratchBucketId(moduleId);
  const client = useClientStore.getState();
  client.selectTask(TEMP_TASK_ID);
  client.ensureWorkspace(bucket);
  client.setActive(bucket, "changes");
  rememberStudioWorkspaceTarget(bucket, { kind: "changes" });
}

export function openTaskChangesWorkspace(taskId: string): void {
  const client = useClientStore.getState();
  client.selectTask(taskId);
  client.ensureWorkspace(taskId);
  client.setActive(taskId, "changes");
  rememberStudioWorkspaceTarget(taskId, { kind: "changes" });
}
