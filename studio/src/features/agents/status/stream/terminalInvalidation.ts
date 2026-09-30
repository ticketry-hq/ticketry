import { useTerminalStore } from "../../terminal/internal/sessionStore";
import { refreshTerminalHoldings } from "../../terminal/refresh";

export { refreshTerminalHoldings } from "../../terminal/refresh";

export function settleTerminalHolding(agentRunId: string): void {
  settleTerminalHoldings([agentRunId]);
}

export function settleTerminalHoldings(agentRunIds: readonly string[]): void {
  const sessions = useTerminalStore.getState();
  for (const agentRunId of agentRunIds) {
    const sessionId = sessions.sessionByRun[agentRunId];
    if (sessionId) sessions.closeTab(sessionId, { dismiss: false });
  }
  void refreshTerminalHoldings();
}
