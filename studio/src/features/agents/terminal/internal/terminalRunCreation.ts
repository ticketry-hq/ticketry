import { createTerminalRun } from "../../api/agentApi";
import { useTerminalStore, type SessionMeta } from "./sessionStore";

const pendingCreations = new Map<string, Promise<void>>();

/** Creates the durable run without choosing or attaching a terminal renderer. */
export function ensureTerminalRunCreated(
  sessionId: string,
  session: SessionMeta,
): void {
  if (session.agentRunId || pendingCreations.has(sessionId)) return;

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
    .catch(() => {
      if (useTerminalStore.getState().sessions[sessionId]) {
        useTerminalStore.getState().setError(sessionId);
      }
    })
    .finally(() => {
      if (pendingCreations.get(sessionId) === creation) {
        pendingCreations.delete(sessionId);
      }
    });

  pendingCreations.set(sessionId, creation);
}
