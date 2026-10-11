import { toast } from "../../../../state/clientStore";
import { createTerminalRun } from "../../api/agentApi";
import { launchFailureMessage } from "./launchFailure";
import { useTerminalStore, type SessionMeta } from "./sessionStore";

const pendingCreations = new Map<string, Promise<void>>();

/** Creates the durable run without choosing or attaching a terminal renderer. */
export function ensureTerminalRunCreated(
  sessionId: string,
  session: SessionMeta,
): void {
  // A session with no provider never spawns here: a shell run is launched by
  // its own entry point and arrives with its run already bound (#667).
  if (session.agentRunId || !session.agent || pendingCreations.has(sessionId)) {
    return;
  }

  const creation = createTerminalRun({
    agent: session.agent,
    project_id: session.projectId,
    module_id: session.moduleId,
    task_id: session.taskId,
    initial_prompt: session.isInstant ? null : session.initialPrompt,
    is_planning: session.isPlanning,
    is_instant: session.isInstant,
    instant_prompt: session.isInstant ? session.initialPrompt : null,
  })
    .then(({ agent_run_id }) => {
      const store = useTerminalStore.getState();
      const current = store.sessions[sessionId];
      if (!current || current.agentRunId) return;
      store.bindRun(sessionId, agent_run_id);
    })
    .catch((error) => {
      // A refused create never produced a run, so its placeholder tab would
      // be a phantom terminal. Drop it (the workspace falls back to its prior
      // surface) and say why, leaving the user free to retry (CODING-2763).
      const store = useTerminalStore.getState();
      if (store.sessions[sessionId]) store.closeTab(sessionId, { dismiss: false });
      const subject = session.isInstant || session.isPlanning
        ? "Conversation did not start"
        : "Agent run could not be started";
      toast.error(`${subject}: ${launchFailureMessage(error)}`);
    })
    .finally(() => {
      if (pendingCreations.get(sessionId) === creation) {
        pendingCreations.delete(sessionId);
      }
    });

  pendingCreations.set(sessionId, creation);
}
