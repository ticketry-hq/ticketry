import { useStudioStore } from "../../projects";
import { readAgentRun } from "../status";
import {
  bucketFor,
  foregroundKey,
  useTerminalForegroundStore,
  useTerminalStore,
} from "../terminal/appNavigation";
import { TEMP_TASK_ID } from "../types";
import { studioRuntime } from "../../../runtime";
import { useClientStore } from "../../../state/clientStore";
import { revealRunStory } from "./revealRunStory";
import { selectedRunSession } from "./selectedAgentRun";
import { rememberStudioWorkspaceTarget } from "../../workspace-state/studioWorkspaceTarget";
import {
  AGENT_RUN_ACTIONS,
  type AgentRunActionId,
} from "../../../app/navigation/actionIds";

function runIdFrom(payload: unknown): string | null {
  if (typeof payload === "string" && payload.length > 0) return payload;
  if (!payload || typeof payload !== "object") return null;
  const runId = (payload as { runId?: unknown }).runId;
  return typeof runId === "string" && runId.length > 0 ? runId : null;
}

async function focusAgentRun(payload?: unknown): Promise<boolean> {
  const runId = runIdFrom(payload);
  if (!runId) return false;

  const run = readAgentRun(runId);
  if (!run) return false;
  const selectedProjectId = useStudioStore.getState().selectedProjectId;
  if (run.project_id && run.project_id !== selectedProjectId) return false;

  let workspace = useClientStore.getState();
  if (workspace.selectedModuleId !== run.module_id) {
    await workspace.selectModule(run.module_id);
    workspace = useClientStore.getState();
    if (workspace.selectedModuleId !== run.module_id) return false;
  }

  const taskId = run.scope === "task" ? run.task_id : null;
  if (run.scope === "task" && !taskId) return false;

  const terminal = useTerminalStore.getState();
  let sessionId = terminal.sessionByRun[runId] ?? null;
  if (!sessionId || !terminal.sessions[sessionId]) {
    try {
      sessionId = terminal.attachRun(runId);
    } catch {
      return false;
    }
  }

  const session = useTerminalStore.getState().sessions[sessionId];
  if (!session) return false;
  const bucket = bucketFor(session.taskId, session.moduleId);
  workspace = useClientStore.getState();
  // Commit the explicit destination before selecting the Story mounts its
  // workspace and restores the previously remembered surface.
  rememberStudioWorkspaceTarget(bucket, { kind: "terminal", agentRunId: runId });
  workspace.setActive(bucket, "terminal");
  workspace.selectTask(taskId ?? TEMP_TASK_ID);
  if (taskId) revealRunStory(selectedProjectId, run.module_id, taskId);
  if (workspace.sidebarVisible) {
    workspace.setFocusedPane("details-or-terminal");
  } else {
    workspace.setEditViewZone("active-tab-body");
    workspace.setEditViewBodyEngaged(true);
  }
  useTerminalForegroundStore
    .getState()
    .acquire(foregroundKey(session), "studio");
  useTerminalStore.getState().focusSession(sessionId);
  return true;
}

async function toggleVoiceTranscription(): Promise<boolean> {
  await studioRuntime().launchkey.toggleHandyTranscription();
  return true;
}

function selectedRunViewerHandle(): string | null {
  const session = selectedRunSession();
  if (
    !session?.agentRunId ||
    session.status !== "ready" ||
    session.transport !== "ready"
  ) {
    return null;
  }
  return session.sessionId;
}

async function submitSelectedRunTerminal(): Promise<boolean> {
  const viewerHandle = selectedRunViewerHandle();
  if (!viewerHandle) return false;
  await studioRuntime().launchkey.submitTerminal(viewerHandle);
  return true;
}

export {
  readSelectedAgentRunId,
  subscribeSelectedAgentRun,
} from "./selectedAgentRun";

export function dispatchAgentRunAction(
  actionId: AgentRunActionId,
  payload?: unknown,
): Promise<boolean> {
  switch (actionId) {
    case AGENT_RUN_ACTIONS.focusAgentRun:
      return focusAgentRun(payload);
    case AGENT_RUN_ACTIONS.toggleVoiceTranscription:
      return toggleVoiceTranscription();
    case AGENT_RUN_ACTIONS.submitSelectedRunTerminal:
      return submitSelectedRunTerminal();
  }
}
