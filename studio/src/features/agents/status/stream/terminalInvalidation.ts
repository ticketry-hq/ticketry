import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";
import { useTerminalStore } from "../../terminal/internal/sessionStore";

const TERMINAL_HOLDINGS = ["terminal-sessions"] as const;

export function refreshTerminalHoldings(): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: TERMINAL_HOLDINGS,
    refetchType: "active",
  });
}

export function settleTerminalHolding(agentRunId: string): void {
  const sessions = useTerminalStore.getState();
  const sessionId = sessions.sessionByRun[agentRunId];
  if (!sessionId) {
    void refreshTerminalHoldings();
    return;
  }
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
        : queryKeys.terminalSessions.scratch(session.projectId, session.moduleId),
      exact: true,
    });
  }
  void refreshTerminalHoldings();
}
