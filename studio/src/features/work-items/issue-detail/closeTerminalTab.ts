import {
  useTerminalStore,
} from "../../agents/terminal/appNavigation";
import { toast } from "../../../app/stores/toastStore";
import { apiErrorMessage } from "../../../shared/api/client";
import type { SessionId } from "../../agents/types";
import { useIssueDrawerWorkspaceStore } from "./internal/drawerWorkspaceStore";
import { terminalLabel } from "./terminalLabel";

/**
 * Close a terminal tab and retain its inert history chip. Kept separate from
 * resume actions so the app-level keymap does not load the resume graph.
 */
export async function closeTerminalTab(
  sessionId: SessionId,
  bucket: string,
): Promise<void> {
  const term = useTerminalStore.getState();
  const meta = term.sessions[sessionId];
  if (!meta) return;
  const chip = {
    agentRunId: meta.agentRunId,
    agent: meta.agent,
    label: terminalLabel(meta),
  };
  if (meta.agentRunId) {
    try {
      await term.terminatePersisted(meta.agentRunId, bucket);
    } catch (error) {
      toast.error(`Terminal could not be closed: ${apiErrorMessage(error)}`);
      return;
    }
  } else {
    term.closeTab(sessionId);
  }
  useIssueDrawerWorkspaceStore.getState().recordClosedRun(bucket, chip);
}
