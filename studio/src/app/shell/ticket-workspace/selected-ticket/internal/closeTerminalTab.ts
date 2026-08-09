import {
  useTerminalStore,
} from "../../../../../features/agents/terminal/appNavigation";
import { toast } from "../../../../../state/clientStore";
import { apiErrorMessage } from "../../../../../shared/api/client";
import type { SessionId } from "../../../../../features/agents/types";

/**
 * Close a terminal tab. Run history remains in the run projection.
 */
export async function closeTerminalTab(
  sessionId: SessionId,
  bucket: string,
): Promise<void> {
  const term = useTerminalStore.getState();
  const meta = term.sessions[sessionId];
  if (!meta) return;
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
}
