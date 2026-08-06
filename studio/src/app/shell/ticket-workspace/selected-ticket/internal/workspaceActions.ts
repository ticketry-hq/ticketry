import {
  isScratchBucket,
  useTerminalStore,
} from "../../../../../features/agents/terminal/appNavigation";
import { useTicketWorkspaceStore } from "../state/ticketWorkspaceStore";
import { toast } from "../../../../../state/clientStore";
import { ApiError } from "../../../../../features/agents/api/agentApi";

/** Returns true when the run was resumed and attached, false on failure. */
export async function resumeTerminalTab(
  taskId: string,
  bucket: string,
  agentRunId: string,
  projectId?: string,
  moduleId?: string,
): Promise<boolean> {
  const term = useTerminalStore.getState();
  try {
    const resumedRunId = await term.resumePersisted(agentRunId, taskId, projectId, moduleId);
    // Re-read the store: resumePersisted replaced state, so the pre-await
    // snapshot's persistedSessions predates the refreshed list.
    const fresh = useTerminalStore.getState();
    const session = fresh.persistedSessions[taskId]?.find(
      (row) => row.agent_run_id === resumedRunId,
    );
    if (session) fresh.attachPersisted(session);
    useTicketWorkspaceStore.getState().setActive(bucket, "terminal");
    return true;
  } catch (error) {
    const body = error instanceof ApiError ? error.body : null;
    const code = extractResumeErrorCode(body, error);
    const message =
      code === "cwd_missing"
        ? "Working directory no longer exists"
        : code === "run_still_active"
          ? "Session is still running - attach instead"
          : code === "resume_unsupported"
            ? "This agent cannot resume sessions"
            : code === "no_provider_session_id"
              ? "Could not resume session"
              : "Could not resume session";
    toast.error(message);
    await term.refreshResumable(
      isScratchBucket(taskId) ? undefined : taskId,
      projectId,
      moduleId,
    );
    return false;
  }
}

function extractResumeErrorCode(body: unknown, error: unknown): string {
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (detail && typeof detail === "object" && "error" in detail) {
      return String((detail as { error?: unknown }).error);
    }
    if ("error" in body) return String((body as { error?: unknown }).error);
  }
  return error instanceof Error ? error.message : String(error);
}
