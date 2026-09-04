import { useStudioStore } from "../../projects";
import { readAgentStatusHolding } from "../status";
import {
  bucketFor,
  foregroundKey,
  useTerminalForegroundStore,
  useTerminalStore,
} from "../terminal/appNavigation";
import { TEMP_TASK_ID } from "../types";
import { studioRuntime } from "../../../runtime";
import { useClientStore } from "../../../state/clientStore";
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

  const run = readAgentStatusHolding().runs[runId];
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
  workspace.selectTask(taskId ?? TEMP_TASK_ID);

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
  workspace.setActive(bucket, "terminal");
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
  const workspace = useClientStore.getState();
  if (!workspace.selectedTaskId) return null;
  const bucket = workspace.selectedTaskId === TEMP_TASK_ID
    ? bucketFor(null, workspace.selectedModuleId)
    : bucketFor(workspace.selectedTaskId, workspace.selectedModuleId);
  if (workspace.workspaces[bucket]?.active !== "terminal") return null;

  const sessionId = workspace.activeByTask[bucket];
  const session = sessionId
    ? useTerminalStore.getState().sessions[sessionId]
    : null;
  if (
    !session?.agentRunId ||
    session.status !== "ready" ||
    session.transport !== "ready"
  ) {
    return null;
  }
  return sessionId;
}

async function submitSelectedRunTerminal(): Promise<boolean> {
  const viewerHandle = selectedRunViewerHandle();
  if (!viewerHandle) return false;
  await studioRuntime().launchkey.submitTerminal(viewerHandle);
  return true;
}

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
