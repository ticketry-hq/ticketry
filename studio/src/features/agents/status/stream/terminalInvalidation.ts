import { useTerminalStore } from "../../terminal/internal/sessionStore";
import { refreshTerminalHoldings } from "../../terminal/refresh";

export { refreshTerminalHoldings } from "../../terminal/refresh";

export function settleTerminalHolding(agentRunId: string): void {
  const sessions = useTerminalStore.getState();
  const sessionId = sessions.sessionByRun[agentRunId];
  if (!sessionId) {
    void refreshTerminalHoldings();
    return;
  }
  sessions.closeTab(sessionId, { dismiss: false });
  void refreshTerminalHoldings();
}
