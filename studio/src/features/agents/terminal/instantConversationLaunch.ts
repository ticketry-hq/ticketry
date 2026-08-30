import { TEMP_TASK_ID } from "../types";
import { useClientStore } from "../../../state/clientStore";
import { attachToRun } from "./internal/actions";
import { scratchBucketId, useTerminalStore } from "./internal/sessionStore";
import { createDefaultInstantConversation } from "./internal/mutationTransport";

export interface InstantConversationLaunchRequest {
  projectId: string;
  moduleId: string;
}

/** Launch and select one Instant conversation backed by one terminal run. */
export async function launchInstantConversation(
  request: InstantConversationLaunchRequest,
): Promise<string> {
  const created = await createDefaultInstantConversation(request);
  const sessionId = attachToRun({
    taskId: null,
    projectId: request.projectId,
    moduleId: request.moduleId,
    agent: created.agent,
    agentRunId: created.agent_run_id,
    isInstant: true,
    select: true,
  });
  const bucket = scratchBucketId(request.moduleId);
  const workspace = useClientStore.getState();
  workspace.selectTask(TEMP_TASK_ID);
  workspace.tabSelected(bucket, sessionId);
  workspace.setActive(bucket, "terminal");
  useTerminalStore.getState().focusSession(sessionId);
  return created.agent_run_id;
}
