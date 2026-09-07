import {
  bucketFor,
  useTerminalStore,
  type SessionMeta,
} from "../terminal/appNavigation";
import { TEMP_TASK_ID } from "../types";
import { useClientStore } from "../../../state/clientStore";

/** The terminal session shown for the selected Story, when its terminal tab is active. */
export function selectedRunSession(): SessionMeta | null {
  const workspace = useClientStore.getState();
  if (!workspace.selectedTaskId) return null;
  const bucket = workspace.selectedTaskId === TEMP_TASK_ID
    ? bucketFor(null, workspace.selectedModuleId)
    : bucketFor(workspace.selectedTaskId, workspace.selectedModuleId);
  if (workspace.workspaces[bucket]?.active !== "terminal") return null;
  const sessionId = workspace.activeByTask[bucket];
  return (sessionId && useTerminalStore.getState().sessions[sessionId]) || null;
}

/** The agent run whose terminal is currently in front of the user. */
export function readSelectedAgentRunId(): string | null {
  return selectedRunSession()?.agentRunId ?? null;
}

export function subscribeSelectedAgentRun(listener: () => void): () => void {
  const stopWorkspace = useClientStore.subscribe(listener);
  const stopTerminal = useTerminalStore.subscribe(listener);
  return () => {
    stopWorkspace();
    stopTerminal();
  };
}
