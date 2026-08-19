import {
  type AgentStatusFrame,
  type StatusDocumentFrame,
} from "@worktracker/typescript-sdk/agent-status";
import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";
import { useClientStore } from "../../../../state/clientStore";
import { scratchBucketId, useTerminalStore } from "../../terminal";
import type { DesignDoc } from "../../types";
import { SCRATCH_RUN_TASK_ID } from "../../types";
import { useAgentStatusStore } from "../store";

/** Apply retired socket frames only in tests that characterize the shared holdings. */
export function dispatchStatusFrame(frame: AgentStatusFrame): void {
  const runs = useAgentStatusStore.getState();
  if (frame.type === "snapshot") {
    if (runs.projectId !== frame.scope.project_id) return;
    runs.reconcileScope(frame.scope, frame.runs, frame.at);
    runs.reconcileAutomationAttempts(frame.automation_attempts);
    return;
  }
  if (frame.type === "agent_lifecycle") {
    if (frame.run.project_id && runs.projectId !== frame.run.project_id) return;
    runs.upsertRun(frame.run);
    return;
  }
  if (frame.type === "terminal_activity") {
    if (frame.run.project_id && runs.projectId !== frame.run.project_id) return;
    runs.applyActivity(frame.run);
    return;
  }
  if (frame.type === "backend_session") {
    const sessions = useTerminalStore.getState();
    const sessionId = sessions.sessionByRun[frame.agent_run_id];
    if (sessionId) {
      if (frame.status === "lost") sessions.setSessionLost(sessionId);
      else {
        const session = sessions.sessions[sessionId];
        sessions.closeTab(sessionId, { dismiss: false });
        if (session && !session.isShell) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.terminalSessions.resumable(
              session.taskId,
              session.taskId ? null : session.projectId,
              session.taskId ? null : session.moduleId,
            ),
            exact: true,
          });
          void queryClient.invalidateQueries({
            queryKey: session.taskId
              ? queryKeys.terminalSessions.persisted(session.taskId)
              : queryKeys.terminalSessions.scratch(
                  session.projectId,
                  session.moduleId,
                ),
            exact: true,
          });
        }
      }
    }
    runs.applyState(
      frame.agent_run_id,
      frame.status === "lost" ? "lost" : "exited",
      frame.at,
      frame.exit_code,
    );
    return;
  }
  if (frame.type === "automation_attempt") {
    if (runs.projectId !== frame.project_id) return;
    runs.upsertAutomationAttempt(frame.attempt);
    return;
  }
  if (frame.type === "document") routeDocumentFrame(frame);
}

function routeDocumentFrame(frame: StatusDocumentFrame): void {
  const { task_id: taskId, doc, event } = frame;
  if (!taskId || !doc?.id || !doc.rel_path) return;
  const bucket = taskId === SCRATCH_RUN_TASK_ID
    ? scratchBucketId(frame.module_id ?? "")
    : taskId;
  const workspace = useClientStore.getState();
  workspace.ensureWorkspace(bucket);
  const designDoc: DesignDoc = {
    id: doc.id,
    rel_path: doc.rel_path,
    label: typeof doc.label === "string" ? doc.label : doc.rel_path,
  };
  const projectId = useAgentStatusStore.getState().projectId;
  const registryKey = taskId === SCRATCH_RUN_TASK_ID
    ? queryKeys.documents.registry("scratch", frame.module_id ?? "", null, frame.module_id)
    : queryKeys.documents.registry("task", taskId, projectId, frame.module_id);
  queryClient.setQueryData<DesignDoc[]>(registryKey, (current) => {
    const documents = current ?? [];
    const existing = documents.findIndex((item) => item.rel_path === designDoc.rel_path);
    return existing < 0
      ? [...documents, designDoc]
      : documents.map((item, index) => index === existing ? designDoc : item);
  });
  workspace.openDoc(bucket, designDoc.id, event === "created");
}
