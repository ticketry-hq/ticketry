import type { SessionId } from "../../types";
import {
  bucketOfMeta,
  useTerminalStore,
  type OpenDocChatArgs,
  type OpenSessionArgs,
} from "./sessionStore";
import { useWorkspaceTabsStore } from "./workspaceTabsStore";

// The launch/close verbs hosts call. The session store registers every
// open/rekey/focus/close with the workspace-tabs store itself (CODIN-981), so
// these stay thin: they exist to keep hosts off the store internals.

export function launchAgent(args: OpenSessionArgs): SessionId {
  return useTerminalStore.getState().openSession(args);
}

export function launchDocumentAgent(args: OpenDocChatArgs): SessionId {
  return useTerminalStore.getState().openDocChat(args);
}

export function attachToRun(args: OpenSessionArgs & { agentRunId: string }): SessionId {
  const sessions = useTerminalStore.getState();
  const existingId = sessions.sessionByRun[args.agentRunId];
  if (existingId && sessions.sessions[existingId]) {
    const meta = sessions.sessions[existingId];
    useWorkspaceTabsStore
      .getState()
      .tabFocused(bucketOfMeta(meta), existingId);
    return existingId;
  }
  return launchAgent(args);
}

export function closeTerminal(sessionId: SessionId): void {
  useTerminalStore.getState().closeTab(sessionId);
}

export function ackTerminal(
  tempId: SessionId,
  sessionId: SessionId,
  agentRunId?: string | null,
): void {
  useTerminalStore.getState().setReady(tempId, sessionId, agentRunId);
}
